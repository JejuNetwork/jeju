/**
 * MCP Authentication Tests
 *
 * Tests agent authentication and API key validation
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { AgentAuthenticator, createAuthenticator } from '../auth/agent-auth'
import {
  type ApiKeyValidationResult,
  type ApiKeyValidator,
  createApiKeyValidator,
  createHashBasedApiKeyValidator,
} from '../auth/api-key-auth'

describe('AgentAuthenticator', () => {
  describe('with static key validator', () => {
    const testKeys = new Map<string, ApiKeyValidationResult>([
      ['valid-key-123', { userId: 'user-1', agentId: 'agent-1' }],
      ['another-key', { userId: 'user-2', agentId: 'agent-2' }],
    ])
    let authenticator: AgentAuthenticator

    beforeEach(() => {
      const validator = createApiKeyValidator({ keys: testKeys })
      authenticator = new AgentAuthenticator(validator)
    })

    it('should return null for empty API key', async () => {
      const result = await authenticator.authenticate({})
      expect(result).toBeNull()
    })

    it('should return null for undefined API key', async () => {
      const result = await authenticator.authenticate({ apiKey: undefined })
      expect(result).toBeNull()
    })

    it('should authenticate valid API key', async () => {
      const result = await authenticator.authenticate({
        apiKey: 'valid-key-123',
      })
      expect(result).toEqual({ userId: 'user-1', agentId: 'agent-1' })
    })

    it('should return null for invalid API key', async () => {
      const result = await authenticator.authenticate({
        apiKey: 'wrong-key',
      })
      expect(result).toBeNull()
    })
  })

  describe('with custom validator', () => {
    it('should use custom validator for authentication', async () => {
      const customValidator: ApiKeyValidator = async (apiKey: string) => {
        if (apiKey === 'valid-key-123') {
          return { userId: 'user-1', agentId: 'agent-1' }
        }
        return null
      }

      const authenticator = new AgentAuthenticator(customValidator)

      const validResult = await authenticator.authenticate({
        apiKey: 'valid-key-123',
      })
      expect(validResult).toEqual({ userId: 'user-1', agentId: 'agent-1' })

      const invalidResult = await authenticator.authenticate({
        apiKey: 'wrong-key',
      })
      expect(invalidResult).toBeNull()
    })
  })

  describe('setApiKeyValidator', () => {
    it('should replace validator at runtime', async () => {
      const initialValidator: ApiKeyValidator = async () => null
      const authenticator = new AgentAuthenticator(initialValidator)

      // Initially fails
      let result = await authenticator.authenticate({ apiKey: 'test-key' })
      expect(result).toBeNull()

      // Set new validator
      authenticator.setApiKeyValidator(async (apiKey) => {
        if (apiKey === 'test-key') {
          return { userId: 'new-user', agentId: 'new-agent' }
        }
        return null
      })

      // Now succeeds
      result = await authenticator.authenticate({ apiKey: 'test-key' })
      expect(result).toEqual({ userId: 'new-user', agentId: 'new-agent' })
    })
  })

  describe('authenticateFromContext', () => {
    it('should authenticate from MCP context', async () => {
      const customValidator: ApiKeyValidator = async (apiKey: string) => {
        if (apiKey === 'context-key') {
          return { userId: 'context-user', agentId: 'context-agent' }
        }
        return null
      }

      const authenticator = new AgentAuthenticator(customValidator)
      const result = await authenticator.authenticateFromContext({
        apiKey: 'context-key',
        userId: 'ignored-user',
      })

      expect(result).toEqual({
        userId: 'context-user',
        agentId: 'context-agent',
      })
    })

    it('should return null for missing API key in context', async () => {
      const nullValidator: ApiKeyValidator = async () => null
      const authenticator = new AgentAuthenticator(nullValidator)
      const result = await authenticator.authenticateFromContext({
        userId: 'user-1',
      })

      expect(result).toBeNull()
    })
  })
})

describe('createAuthenticator', () => {
  it('should create authenticator with given validator', async () => {
    const authenticator = createAuthenticator(async (apiKey) => {
      if (apiKey === 'test') {
        return { userId: 'test-user', agentId: 'test-agent' }
      }
      return null
    })

    const result = await authenticator.authenticate({ apiKey: 'test' })
    expect(result?.userId).toBe('test-user')
  })
})

describe('createApiKeyValidator', () => {
  it('should validate keys from map', async () => {
    const keys = new Map<string, ApiKeyValidationResult>([
      ['key-1', { userId: 'user-1', agentId: 'agent-1' }],
      ['key-2', { userId: 'user-2', agentId: 'agent-2' }],
    ])

    const validator = createApiKeyValidator({ keys })

    const result1 = await validator('key-1')
    expect(result1).toEqual({ userId: 'user-1', agentId: 'agent-1' })

    const result2 = await validator('key-2')
    expect(result2).toEqual({ userId: 'user-2', agentId: 'agent-2' })

    const result3 = await validator('invalid')
    expect(result3).toBeNull()
  })
})

describe('createHashBasedApiKeyValidator', () => {
  it('should hash key and lookup', async () => {
    const hashFn = (key: string) => `hash:${key}`
    const lookupFn = async (
      hash: string,
    ): Promise<ApiKeyValidationResult | null> => {
      if (hash === 'hash:secret') {
        return { userId: 'hashed-user', agentId: 'hashed-agent' }
      }
      return null
    }

    const validator = createHashBasedApiKeyValidator(hashFn, lookupFn)

    const result = await validator('secret')
    expect(result).toEqual({ userId: 'hashed-user', agentId: 'hashed-agent' })

    const invalidResult = await validator('wrong')
    expect(invalidResult).toBeNull()
  })
})

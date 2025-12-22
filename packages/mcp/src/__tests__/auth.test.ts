/**
 * MCP Authentication Tests
 *
 * Tests agent authentication and API key validation
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import {
  AgentAuthenticator,
  authenticateAgent,
  configureAuthentication,
  defaultAuthenticator,
} from '../auth/agent-auth'
import type { ApiKeyValidator } from '../auth/api-key-auth'

describe('AgentAuthenticator', () => {
  describe('with default validator', () => {
    let authenticator: AgentAuthenticator

    beforeEach(() => {
      authenticator = new AgentAuthenticator()
    })

    it('should return null for empty API key', async () => {
      const result = await authenticator.authenticate({})
      expect(result).toBeNull()
    })

    it('should return null for undefined API key', async () => {
      const result = await authenticator.authenticate({ apiKey: undefined })
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

    it('should use userId as agentId if not provided', async () => {
      const customValidator: ApiKeyValidator = async (apiKey: string) => {
        if (apiKey === 'valid') {
          return { userId: 'user-only' }
        }
        return null
      }

      const authenticator = new AgentAuthenticator(customValidator)
      const result = await authenticator.authenticate({ apiKey: 'valid' })

      expect(result).toEqual({ userId: 'user-only', agentId: 'user-only' })
    })
  })

  describe('setApiKeyValidator', () => {
    it('should replace validator at runtime', async () => {
      const authenticator = new AgentAuthenticator()

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
      const authenticator = new AgentAuthenticator()
      const result = await authenticator.authenticateFromContext({
        userId: 'user-1',
      })

      expect(result).toBeNull()
    })
  })
})

describe('authenticateAgent', () => {
  it('should use default authenticator', async () => {
    // Configure with a known validator
    configureAuthentication(async (apiKey) => {
      if (apiKey === 'default-test') {
        return { userId: 'default-user' }
      }
      return null
    })

    const result = await authenticateAgent({ apiKey: 'default-test' })
    expect(result?.userId).toBe('default-user')
  })
})

describe('configureAuthentication', () => {
  it('should configure default authenticator', async () => {
    configureAuthentication(async (apiKey) => {
      if (apiKey === 'configured-key') {
        return { userId: 'configured-user', agentId: 'configured-agent' }
      }
      return null
    })

    const result = await defaultAuthenticator.authenticate({
      apiKey: 'configured-key',
    })
    expect(result).toEqual({
      userId: 'configured-user',
      agentId: 'configured-agent',
    })
  })
})

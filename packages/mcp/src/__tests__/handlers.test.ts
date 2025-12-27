/**
 * MCP Handlers Tests
 *
 * Tests for base handler and request handler functionality.
 */

import { describe, expect, it } from 'bun:test'

// Handler context type
interface HandlerContext {
  userId?: string
  agentId?: string
  apiKey?: string
}

// Base handler interface
interface BaseHandler {
  name: string
  description?: string
  canHandle(method: string): boolean
}

// Request handler interface
interface RequestHandler extends BaseHandler {
  handle(
    method: string,
    params: Record<string, unknown>,
    context: HandlerContext,
  ): Promise<unknown>
}

describe('BaseHandler', () => {
  describe('interface structure', () => {
    it('validates base handler shape', () => {
      const handler: BaseHandler = {
        name: 'test-handler',
        description: 'A test handler',
        canHandle: (method: string) => method.startsWith('test/'),
      }

      expect(handler.name).toBe('test-handler')
      expect(handler.description).toBe('A test handler')
      expect(handler.canHandle('test/method')).toBe(true)
      expect(handler.canHandle('other/method')).toBe(false)
    })

    it('handler can have optional description', () => {
      const handler: BaseHandler = {
        name: 'minimal-handler',
        canHandle: () => true,
      }

      expect(handler.name).toBe('minimal-handler')
      expect(handler.description).toBeUndefined()
    })
  })

  describe('canHandle logic', () => {
    it('matches exact method names', () => {
      const handler: BaseHandler = {
        name: 'exact-handler',
        canHandle: (method) => method === 'exact/match',
      }

      expect(handler.canHandle('exact/match')).toBe(true)
      expect(handler.canHandle('exact/match2')).toBe(false)
    })

    it('matches prefix patterns', () => {
      const handler: BaseHandler = {
        name: 'prefix-handler',
        canHandle: (method) => method.startsWith('tools/'),
      }

      expect(handler.canHandle('tools/call')).toBe(true)
      expect(handler.canHandle('tools/list')).toBe(true)
      expect(handler.canHandle('resources/list')).toBe(false)
    })

    it('matches regex patterns', () => {
      const handler: BaseHandler = {
        name: 'regex-handler',
        canHandle: (method) => /^(tools|resources)\//.test(method),
      }

      expect(handler.canHandle('tools/call')).toBe(true)
      expect(handler.canHandle('resources/read')).toBe(true)
      expect(handler.canHandle('prompts/list')).toBe(false)
    })
  })
})

describe('RequestHandler', () => {
  describe('interface structure', () => {
    it('validates request handler shape', () => {
      const handler: RequestHandler = {
        name: 'request-handler',
        description: 'Handles requests',
        canHandle: (method) => method === 'test/echo',
        handle: async (method, params) => {
          return { method, params }
        },
      }

      expect(handler.name).toBe('request-handler')
      expect(typeof handler.handle).toBe('function')
    })
  })

  describe('handle method', () => {
    it('receives method and params', async () => {
      const handler: RequestHandler = {
        name: 'echo-handler',
        canHandle: () => true,
        handle: async (method, params) => ({ method, params }),
      }

      const result = await handler.handle(
        'test/echo',
        { message: 'hello' },
        {},
      )

      expect(result).toEqual({
        method: 'test/echo',
        params: { message: 'hello' },
      })
    })

    it('receives context with user info', async () => {
      let capturedContext: HandlerContext | undefined

      const handler: RequestHandler = {
        name: 'context-handler',
        canHandle: () => true,
        handle: async (_method, _params, context) => {
          capturedContext = context
          return { authorized: true }
        },
      }

      await handler.handle(
        'test/method',
        {},
        { userId: 'user-123', agentId: 'agent-456', apiKey: 'key-789' },
      )

      expect(capturedContext?.userId).toBe('user-123')
      expect(capturedContext?.agentId).toBe('agent-456')
      expect(capturedContext?.apiKey).toBe('key-789')
    })

    it('can throw errors', async () => {
      const handler: RequestHandler = {
        name: 'error-handler',
        canHandle: () => true,
        handle: async () => {
          throw new Error('Handler error')
        },
      }

      await expect(handler.handle('test', {}, {})).rejects.toThrow(
        'Handler error',
      )
    })
  })
})

describe('HandlerContext', () => {
  it('supports empty context', () => {
    const context: HandlerContext = {}
    expect(context.userId).toBeUndefined()
    expect(context.agentId).toBeUndefined()
    expect(context.apiKey).toBeUndefined()
  })

  it('supports partial context', () => {
    const context: HandlerContext = { userId: 'user-123' }
    expect(context.userId).toBe('user-123')
    expect(context.agentId).toBeUndefined()
  })

  it('supports full context', () => {
    const context: HandlerContext = {
      userId: 'user-123',
      agentId: 'agent-456',
      apiKey: 'api-key-789',
    }
    expect(context.userId).toBe('user-123')
    expect(context.agentId).toBe('agent-456')
    expect(context.apiKey).toBe('api-key-789')
  })
})

describe('Handler chains', () => {
  it('finds appropriate handler by method', () => {
    const handlers: BaseHandler[] = [
      { name: 'tools', canHandle: (m) => m.startsWith('tools/') },
      { name: 'resources', canHandle: (m) => m.startsWith('resources/') },
      { name: 'prompts', canHandle: (m) => m.startsWith('prompts/') },
    ]

    const findHandler = (method: string) =>
      handlers.find((h) => h.canHandle(method))

    expect(findHandler('tools/call')?.name).toBe('tools')
    expect(findHandler('resources/read')?.name).toBe('resources')
    expect(findHandler('prompts/get')?.name).toBe('prompts')
    expect(findHandler('unknown/method')).toBeUndefined()
  })

  it('first matching handler wins', () => {
    const handlers: BaseHandler[] = [
      { name: 'specific', canHandle: (m) => m === 'tools/special' },
      { name: 'general', canHandle: (m) => m.startsWith('tools/') },
    ]

    const findHandler = (method: string) =>
      handlers.find((h) => h.canHandle(method))

    expect(findHandler('tools/special')?.name).toBe('specific')
    expect(findHandler('tools/other')?.name).toBe('general')
  })
})


/**
 * BaseToolHandler Tests
 *
 * Tests for the abstract BaseToolHandler class and createToolHandler utility
 */

import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { BaseToolHandler, createToolHandler } from '../handlers/base-handler'
import type { AuthenticatedAgent } from '../types/mcp'

// Concrete implementation of BaseToolHandler for testing
class EchoHandler extends BaseToolHandler<
  typeof EchoHandler.prototype.schema,
  { echo: string }
> {
  readonly name = 'echo'
  readonly description = 'Echo the input message'
  readonly schema = z.object({
    message: z.string(),
  })

  async execute(
    args: { message: string },
    _agent: AuthenticatedAgent,
  ): Promise<{ echo: string }> {
    return { echo: args.message }
  }
}

class AddHandler extends BaseToolHandler<
  typeof AddHandler.prototype.schema,
  { sum: number }
> {
  readonly name = 'add'
  readonly description = 'Add two numbers'
  readonly schema = z.object({
    a: z.number(),
    b: z.number(),
  })

  async execute(
    args: { a: number; b: number },
    _agent: AuthenticatedAgent,
  ): Promise<{ sum: number }> {
    return { sum: args.a + args.b }
  }
}

const testAgent: AuthenticatedAgent = {
  userId: 'test-user',
  agentId: 'test-agent',
}

describe('BaseToolHandler', () => {
  describe('getTool', () => {
    it('should return MCP tool definition', () => {
      const handler = new EchoHandler()
      const tool = handler.getTool()

      expect(tool.name).toBe('echo')
      expect(tool.description).toBe('Echo the input message')
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.inputSchema.properties.message).toBeDefined()
    })

    it('should include required fields in schema', () => {
      const handler = new AddHandler()
      const tool = handler.getTool()

      expect(tool.inputSchema.required).toContain('a')
      expect(tool.inputSchema.required).toContain('b')
    })
  })

  describe('getValidator', () => {
    it('should return validator function', () => {
      const handler = new EchoHandler()
      const validator = handler.getValidator()

      const result = validator({ message: 'hello' })
      expect(result.message).toBe('hello')
    })

    it('should throw on invalid input', () => {
      const handler = new EchoHandler()
      const validator = handler.getValidator()

      expect(() => validator({ message: 123 })).toThrow()
    })
  })

  describe('getHandler', () => {
    it('should return bound handler function', async () => {
      const handler = new EchoHandler()
      const handlerFn = handler.getHandler()

      const result = await handlerFn({ message: 'test' }, testAgent)
      expect(result.echo).toBe('test')
    })
  })

  describe('getToolDefinition', () => {
    it('should return complete tool definition', () => {
      const handler = new EchoHandler()
      const def = handler.getToolDefinition()

      expect(def.tool.name).toBe('echo')
      expect(def.handler).toBeDefined()
      expect(def.validator).toBeDefined()
    })

    it('should have working handler in definition', async () => {
      const handler = new EchoHandler()
      const def = handler.getToolDefinition()

      const result = await def.handler({ message: 'hello' }, testAgent)
      expect(result.echo).toBe('hello')
    })

    it('should have working validator in definition', () => {
      const handler = new EchoHandler()
      const def = handler.getToolDefinition()

      const validated = def.validator?.({ message: 'test' })
      expect(validated?.message).toBe('test')
    })
  })

  describe('handle', () => {
    it('should validate and execute in one call', async () => {
      const handler = new AddHandler()

      const result = await handler.handle({ a: 2, b: 3 }, testAgent)
      expect(result.sum).toBe(5)
    })

    it('should throw on invalid arguments', async () => {
      const handler = new AddHandler()

      await expect(
        handler.handle({ a: 'not-a-number', b: 3 }, testAgent),
      ).rejects.toThrow()
    })
  })

  describe('execute', () => {
    it('should receive validated arguments', async () => {
      const handler = new EchoHandler()

      const result = await handler.execute({ message: 'hello' }, testAgent)
      expect(result.echo).toBe('hello')
    })

    it('should have access to agent context', async () => {
      class AgentAwareHandler extends BaseToolHandler<
        typeof AgentAwareHandler.prototype.schema,
        { userId: string }
      > {
        readonly name = 'agent-aware'
        readonly description = 'Returns agent info'
        readonly schema = z.object({})

        async execute(
          _args: Record<string, never>,
          agent: AuthenticatedAgent,
        ): Promise<{ userId: string }> {
          return { userId: agent.userId }
        }
      }

      const handler = new AgentAwareHandler()
      const result = await handler.execute({}, testAgent)

      expect(result.userId).toBe('test-user')
    })
  })
})

describe('createToolHandler', () => {
  it('should create tool definition from function', () => {
    const schema = z.object({
      input: z.string(),
    })

    const def = createToolHandler(
      'process',
      'Process input',
      schema,
      async (args) => ({ processed: args.input.toUpperCase() }),
    )

    expect(def.tool.name).toBe('process')
    expect(def.tool.description).toBe('Process input')
  })

  it('should have working handler', async () => {
    const schema = z.object({
      value: z.number(),
    })

    const def = createToolHandler(
      'double',
      'Double a number',
      schema,
      async (args) => ({ result: args.value * 2 }),
    )

    const result = await def.handler({ value: 5 }, testAgent)
    expect(result.result).toBe(10)
  })

  it('should have working validator', () => {
    const schema = z.object({
      name: z.string().min(1),
    })

    const def = createToolHandler(
      'greet',
      'Greet user',
      schema,
      async (args) => ({
        greeting: `Hello, ${args.name}`,
      }),
    )

    const validated = def.validator?.({ name: 'Alice' })
    expect(validated?.name).toBe('Alice')

    expect(() => def.validator?.({ name: '' })).toThrow()
  })

  it('should pass agent to handler', async () => {
    const schema = z.object({})

    const def = createToolHandler(
      'who-am-i',
      'Returns agent ID',
      schema,
      async (_args, agent) => ({ agentId: agent.agentId }),
    )

    const result = await def.handler({}, testAgent)
    expect(result.agentId).toBe('test-agent')
  })
})

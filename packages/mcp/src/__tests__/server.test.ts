/**
 * MCP Server Integration Tests
 *
 * Tests the MCP server: tool registration, request handling, protocol negotiation
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { AgentAuthenticator } from '../auth/agent-auth'
import type { ApiKeyValidator } from '../auth/api-key-auth'
import { createMCPServer, MCPServer } from '../server/mcp-server'
import type { JsonValue, MCPToolDefinition } from '../types/mcp'

// Test validator that accepts any key with 'valid-' prefix
const testValidator: ApiKeyValidator = async (apiKey: string) => {
  if (apiKey.startsWith('valid-')) {
    return { userId: 'test-user', agentId: 'test-agent' }
  }
  return null
}

const testAuthenticator = new AgentAuthenticator(testValidator)

describe('MCPServer', () => {
  let server: MCPServer

  beforeEach(() => {
    server = new MCPServer({
      config: {
        name: 'test-server',
        version: '1.0.0',
        title: 'Test MCP Server',
        instructions: 'Test server for unit tests',
      },
      authenticator: testAuthenticator,
    })
  })

  describe('getServerInfo', () => {
    it('should return server info from config', () => {
      const info = server.getServerInfo()
      expect(info.name).toBe('test-server')
      expect(info.version).toBe('1.0.0')
      expect(info.title).toBe('Test MCP Server')
    })
  })

  describe('getServerCapabilities', () => {
    it('should return default capabilities', () => {
      const capabilities = server.getServerCapabilities()
      expect(capabilities.tools).toBeDefined()
      expect(capabilities.resources).toBeDefined()
      expect(capabilities.prompts).toBeDefined()
      expect(capabilities.logging).toBeDefined()
    })

    it('should merge custom capabilities', () => {
      const customServer = new MCPServer({
        config: {
          name: 'custom',
          version: '1.0.0',
          capabilities: {
            tools: { listChanged: true },
          },
        },
        authenticator: testAuthenticator,
      })

      const capabilities = customServer.getServerCapabilities()
      expect(capabilities.tools?.listChanged).toBe(true)
    })
  })

  describe('getInitializeResult', () => {
    it('should return initialize result with requested version', () => {
      const result = server.getInitializeResult('2024-11-05')
      expect(result.protocolVersion).toBe('2024-11-05')
      expect(result.serverInfo.name).toBe('test-server')
      expect(result.instructions).toBe('Test server for unit tests')
    })

    it('should throw for unsupported protocol versions', () => {
      expect(() =>
        server.getInitializeResult('unsupported-version' as '2024-11-05'),
      ).toThrow()
    })
  })

  describe('registerTool', () => {
    it('should register a tool', () => {
      const tool: MCPToolDefinition = {
        tool: {
          name: 'test-tool',
          description: 'A test tool',
          inputSchema: {
            type: 'object',
            properties: { input: { type: 'string' } },
            required: ['input'],
          },
        },
        handler: async (args: Record<string, JsonValue>) => ({
          result: args.input,
        }),
      }

      server.registerTool(tool)

      expect(server.hasTool('test-tool')).toBe(true)
      expect(server.getTool('test-tool')).toBeDefined()
    })

    it('should replace existing tool with same name', () => {
      const tool1: MCPToolDefinition = {
        tool: {
          name: 'test-tool',
          description: 'First version',
          inputSchema: { type: 'object', properties: {} },
        },
        handler: async () => ({ version: 1 }),
      }

      const tool2: MCPToolDefinition = {
        tool: {
          name: 'test-tool',
          description: 'Second version',
          inputSchema: { type: 'object', properties: {} },
        },
        handler: async () => ({ version: 2 }),
      }

      server.registerTool(tool1)
      server.registerTool(tool2)

      expect(server.getTool('test-tool')?.tool.description).toBe(
        'Second version',
      )
    })
  })

  describe('registerTools', () => {
    it('should register multiple tools', () => {
      const tools: MCPToolDefinition[] = [
        {
          tool: {
            name: 'tool-1',
            description: 'Tool 1',
            inputSchema: { type: 'object', properties: {} },
          },
          handler: async () => ({ result: 1 }),
        },
        {
          tool: {
            name: 'tool-2',
            description: 'Tool 2',
            inputSchema: { type: 'object', properties: {} },
          },
          handler: async () => ({ result: 2 }),
        },
      ]

      server.registerTools(tools)

      expect(server.hasTool('tool-1')).toBe(true)
      expect(server.hasTool('tool-2')).toBe(true)
    })
  })

  describe('unregisterTool', () => {
    it('should remove registered tool', () => {
      server.registerTool({
        tool: {
          name: 'temp-tool',
          description: 'Temporary',
          inputSchema: { type: 'object', properties: {} },
        },
        handler: async () => ({ result: 'temp' }),
      })

      expect(server.hasTool('temp-tool')).toBe(true)

      const removed = server.unregisterTool('temp-tool')

      expect(removed).toBe(true)
      expect(server.hasTool('temp-tool')).toBe(false)
    })

    it('should return false for non-existent tool', () => {
      const removed = server.unregisterTool('non-existent')
      expect(removed).toBe(false)
    })
  })

  describe('getTools', () => {
    it('should return all registered tools', () => {
      server.registerTools([
        {
          tool: {
            name: 'a',
            description: 'A',
            inputSchema: { type: 'object', properties: {} },
          },
          handler: async () => ({}),
        },
        {
          tool: {
            name: 'b',
            description: 'B',
            inputSchema: { type: 'object', properties: {} },
          },
          handler: async () => ({}),
        },
      ])

      const tools = server.getTools()

      expect(tools).toHaveLength(2)
      expect(tools.map((t) => t.name)).toEqual(['a', 'b'])
    })
  })

  describe('handleRequest', () => {
    const validAuthContext = { apiKey: 'valid-key' }

    it('should handle initialize request', async () => {
      const response = await server.handleRequest(
        {
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
          id: 1,
        },
        validAuthContext,
      )

      expect(response.jsonrpc).toBe('2.0')
      expect(response.id).toBe(1)
      expect(response.result).toBeDefined()
      expect(response.error).toBeUndefined()
    })

    it('should handle ping request', async () => {
      const response = await server.handleRequest(
        {
          jsonrpc: '2.0',
          method: 'ping',
          id: 2,
        },
        validAuthContext,
      )

      expect(response.result).toEqual({})
    })

    it('should handle tools/list request', async () => {
      server.registerTool({
        tool: {
          name: 'echo',
          description: 'Echo input',
          inputSchema: {
            type: 'object',
            properties: { message: { type: 'string' } },
          },
        },
        handler: async (args: Record<string, JsonValue>) => args,
      })

      const response = await server.handleRequest(
        {
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 3,
        },
        validAuthContext,
      )

      const result = response.result
      if (!result || typeof result !== 'object' || !('tools' in result)) {
        throw new Error('Expected result with tools array')
      }
      const tools = result.tools as Array<{ name: string }>
      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('echo')
    })

    it('should handle tools/call request with valid auth', async () => {
      server.registerTool({
        tool: {
          name: 'add',
          description: 'Add numbers',
          inputSchema: {
            type: 'object',
            properties: {
              a: { type: 'number' },
              b: { type: 'number' },
            },
            required: ['a', 'b'],
          },
        },
        handler: async (args: Record<string, JsonValue>) => {
          const a = args.a
          const b = args.b
          if (typeof a !== 'number' || typeof b !== 'number') {
            throw new Error('Expected numeric arguments')
          }
          return { sum: a + b }
        },
      })

      const response = await server.handleRequest(
        {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: 'add',
            arguments: { a: 5, b: 3 },
          },
          id: 4,
        },
        validAuthContext,
      )

      const result = response.result
      if (!result || typeof result !== 'object' || !('content' in result)) {
        throw new Error('Expected result with content array')
      }
      const content = result.content as Array<{ type: string; text: string }>
      expect(content[0].type).toBe('text')
      expect(JSON.parse(content[0].text)).toEqual({ sum: 8 })
    })

    it('should reject tools/call with invalid auth', async () => {
      server.registerTool({
        tool: {
          name: 'protected',
          description: 'Protected tool',
          inputSchema: { type: 'object', properties: {} },
        },
        handler: async () => ({ secret: 'data' }),
      })

      const response = await server.handleRequest(
        {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: 'protected',
            arguments: {},
          },
          id: 5,
        },
        { apiKey: 'invalid-key' },
      )

      expect(response.error).toBeDefined()
      expect(response.error?.message).toContain('Authentication failed')
    })

    it('should return error for unknown method', async () => {
      const response = await server.handleRequest(
        {
          jsonrpc: '2.0',
          method: 'unknown/method',
          id: 5,
        },
        validAuthContext,
      )

      expect(response.error).toBeDefined()
      expect(response.error?.code).toBe(-32601) // Method not found
    })

    it('should return error for invalid JSON-RPC request', async () => {
      const response = await server.handleRequest(
        {
          jsonrpc: '1.0', // Invalid version
          method: 'ping',
          id: 6,
        },
        validAuthContext,
      )

      expect(response.error).toBeDefined()
      expect(response.error?.code).toBe(-32600) // Invalid request
    })

    it('should return error for unknown tool', async () => {
      const response = await server.handleRequest(
        {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: 'non-existent-tool',
            arguments: {},
          },
          id: 7,
        },
        validAuthContext,
      )

      expect(response.error).toBeDefined()
      expect(response.error?.message).toContain('Unknown tool')
    })

    it('should handle resources/list request', async () => {
      server.registerResource({
        resource: {
          uri: 'test://resource',
          name: 'Test Resource',
          description: 'A test resource',
        },
        handler: async () => 'resource content',
      })

      const response = await server.handleRequest(
        {
          jsonrpc: '2.0',
          method: 'resources/list',
          id: 8,
        },
        validAuthContext,
      )

      const result = response.result as { resources: Array<{ uri: string }> }
      expect(result.resources).toHaveLength(1)
      expect(result.resources[0].uri).toBe('test://resource')
    })

    it('should handle resources/read request', async () => {
      server.registerResource({
        resource: {
          uri: 'test://resource',
          name: 'Test Resource',
          mimeType: 'text/plain',
        },
        handler: async () => 'resource content',
      })

      const response = await server.handleRequest(
        {
          jsonrpc: '2.0',
          method: 'resources/read',
          params: { uri: 'test://resource' },
          id: 9,
        },
        validAuthContext,
      )

      const result = response.result as {
        contents: Array<{ uri: string; text: string }>
      }
      expect(result.contents[0].text).toBe('resource content')
    })

    it('should handle prompts/list request', async () => {
      server.registerPrompt({
        prompt: {
          name: 'test-prompt',
          description: 'A test prompt',
        },
        handler: async () => 'Hello from prompt',
      })

      const response = await server.handleRequest(
        {
          jsonrpc: '2.0',
          method: 'prompts/list',
          id: 10,
        },
        validAuthContext,
      )

      const result = response.result as { prompts: Array<{ name: string }> }
      expect(result.prompts).toHaveLength(1)
      expect(result.prompts[0].name).toBe('test-prompt')
    })

    it('should handle prompts/get request', async () => {
      server.registerPrompt({
        prompt: {
          name: 'greeting',
          description: 'A greeting prompt',
        },
        handler: async (args) => `Hello, ${args.name ?? 'world'}`,
      })

      const response = await server.handleRequest(
        {
          jsonrpc: '2.0',
          method: 'prompts/get',
          params: { name: 'greeting', arguments: { name: 'Alice' } },
          id: 11,
        },
        validAuthContext,
      )

      const result = response.result as {
        messages: Array<{ content: { text: string } }>
      }
      expect(result.messages[0].content.text).toBe('Hello, Alice')
    })
  })
})

describe('createMCPServer', () => {
  it('should create server with initial tools', () => {
    const server = createMCPServer(
      {
        config: { name: 'test', version: '1.0.0' },
        authenticator: testAuthenticator,
      },
      [
        {
          tool: {
            name: 'tool1',
            description: 'Tool 1',
            inputSchema: { type: 'object', properties: {} },
          },
          handler: async () => ({}),
        },
      ],
    )

    expect(server.hasTool('tool1')).toBe(true)
  })

  it('should create server with no initial tools', () => {
    const server = createMCPServer({
      config: { name: 'test', version: '1.0.0' },
      authenticator: testAuthenticator,
    })

    expect(server.getTools()).toHaveLength(0)
  })
})

describe('MCPServer with validation', () => {
  let server: MCPServer
  const validAuthContext = { apiKey: 'valid-key' }

  beforeEach(() => {
    server = new MCPServer({
      config: {
        name: 'validated-server',
        version: '1.0.0',
      },
      authenticator: testAuthenticator,
    })
  })

  it('should validate tool arguments with Zod schema', async () => {
    const inputSchema = z.object({
      name: z.string().min(1),
      count: z.number().positive(),
    })

    server.registerTool({
      tool: {
        name: 'validated-tool',
        description: 'Tool with validation',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            count: { type: 'number' },
          },
          required: ['name', 'count'],
        },
      },
      validator: (args: unknown) => inputSchema.parse(args),
      handler: async (args: Record<string, JsonValue>) => ({
        greeting: `Hello ${args.name}, count: ${args.count}`,
      }),
    })

    // Valid request
    const validResponse = await server.handleRequest(
      {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'validated-tool',
          arguments: { name: 'Alice', count: 5 },
        },
        id: 1,
      },
      validAuthContext,
    )

    expect(validResponse.error).toBeUndefined()

    // Invalid request (empty name)
    const invalidResponse = await server.handleRequest(
      {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'validated-tool',
          arguments: { name: '', count: 5 },
        },
        id: 2,
      },
      validAuthContext,
    )

    expect(invalidResponse.error).toBeDefined()
    expect(invalidResponse.error?.message).toContain('Invalid arguments')
  })
})

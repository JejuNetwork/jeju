/**
 * MCP Server Integration Tests
 *
 * Tests the MCP server: tool registration, request handling, protocol negotiation
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { z } from 'zod'
import {
  createMCPServer,
  DEFAULT_MCP_PROTOCOL_VERSION,
  MCPServer,
} from '../server/mcp-server'
import type { JsonValue, MCPToolDefinition } from '../types/mcp'

describe('MCPServer', () => {
  let server: MCPServer

  beforeEach(() => {
    server = new MCPServer({
      name: 'test-server',
      version: '1.0.0',
      title: 'Test MCP Server',
      instructions: 'Test server for unit tests',
    })
    // Disable auth for testing
    server.setRequireAuth(false)
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
        name: 'custom',
        version: '1.0.0',
        capabilities: {
          tools: { listChanged: true },
        },
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

    it('should fallback to default version for unsupported versions', () => {
      const result = server.getInitializeResult(
        'unsupported-version' as '2024-11-05',
      )
      expect(result.protocolVersion).toBe(DEFAULT_MCP_PROTOCOL_VERSION)
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
    it('should handle initialize request', async () => {
      const response = await server.handleRequest({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
        id: 1,
      })

      expect(response.jsonrpc).toBe('2.0')
      expect(response.id).toBe(1)
      expect(response.result).toBeDefined()
      expect(response.error).toBeUndefined()
    })

    it('should handle ping request', async () => {
      const response = await server.handleRequest({
        jsonrpc: '2.0',
        method: 'ping',
        id: 2,
      })

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

      const response = await server.handleRequest({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 3,
      })

      const result = response.result as { tools: Array<{ name: string }> }
      expect(result.tools).toHaveLength(1)
      expect(result.tools[0].name).toBe('echo')
    })

    it('should handle tools/call request', async () => {
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
        handler: async (args: Record<string, JsonValue>) => ({
          sum: (args.a as number) + (args.b as number),
        }),
      })

      const response = await server.handleRequest({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'add',
          arguments: { a: 5, b: 3 },
        },
        id: 4,
      })

      const result = response.result as {
        content: Array<{ type: string; text: string }>
      }
      expect(result.content[0].type).toBe('text')
      expect(JSON.parse(result.content[0].text)).toEqual({ sum: 8 })
    })

    it('should return error for unknown method', async () => {
      const response = await server.handleRequest({
        jsonrpc: '2.0',
        method: 'unknown/method',
        id: 5,
      })

      expect(response.error).toBeDefined()
      expect(response.error?.code).toBe(-32601) // Method not found
    })

    it('should return error for invalid JSON-RPC request', async () => {
      const response = await server.handleRequest({
        jsonrpc: '1.0', // Invalid version
        method: 'ping',
        id: 6,
      })

      expect(response.error).toBeDefined()
      expect(response.error?.code).toBe(-32600) // Invalid request
    })

    it('should return error for unknown tool', async () => {
      const response = await server.handleRequest({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'non-existent-tool',
          arguments: {},
        },
        id: 7,
      })

      expect(response.error).toBeDefined()
      expect(response.error?.message).toContain('Unknown tool')
    })
  })
})

describe('createMCPServer', () => {
  it('should create server with initial tools', () => {
    const server = createMCPServer({ name: 'test', version: '1.0.0' }, [
      {
        tool: {
          name: 'tool1',
          description: 'Tool 1',
          inputSchema: { type: 'object', properties: {} },
        },
        handler: async () => ({}),
      },
    ])

    expect(server.hasTool('tool1')).toBe(true)
  })

  it('should create server with no initial tools', () => {
    const server = createMCPServer({ name: 'test', version: '1.0.0' })

    expect(server.getTools()).toHaveLength(0)
  })
})

describe('MCPServer with validation', () => {
  let server: MCPServer

  beforeEach(() => {
    server = new MCPServer({
      name: 'validated-server',
      version: '1.0.0',
    })
    server.setRequireAuth(false)
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
      validator: (args: Record<string, unknown>) => inputSchema.parse(args),
      handler: async (args: Record<string, JsonValue>) => ({
        greeting: `Hello ${args.name}, count: ${args.count}`,
      }),
    })

    // Valid request
    const validResponse = await server.handleRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'validated-tool',
        arguments: { name: 'Alice', count: 5 },
      },
      id: 1,
    })

    expect(validResponse.error).toBeUndefined()

    // Invalid request (empty name)
    const invalidResponse = await server.handleRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'validated-tool',
        arguments: { name: '', count: 5 },
      },
      id: 2,
    })

    expect(invalidResponse.error).toBeDefined()
    expect(invalidResponse.error?.message).toContain('Invalid arguments')
  })
})

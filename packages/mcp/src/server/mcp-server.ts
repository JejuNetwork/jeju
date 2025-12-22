/**
 * MCP Server Implementation
 *
 * Provides a configurable MCP server that accepts tools at runtime.
 * Uses Zod schemas as single source of truth for tool input validation.
 */

import { MCPRequestHandler } from '../handlers/request-handler'
import type {
  Implementation,
  InitializeResult,
  MCPProtocolVersion,
  MCPServerConfig,
  MCPTool,
  MCPToolDefinition,
  ServerCapabilities,
} from '../types/mcp'
import { MCP_PROTOCOL_VERSIONS } from '../types/mcp'

/**
 * Default MCP protocol version
 */
export const DEFAULT_MCP_PROTOCOL_VERSION: MCPProtocolVersion = '2024-11-05'

/**
 * MCP Server
 *
 * A configurable Model Context Protocol server that accepts tools
 * at runtime via configuration or registration methods.
 *
 * @example
 * ```typescript
 * const server = new MCPServer({
 *   name: 'My MCP Server',
 *   version: '1.0.0',
 *   instructions: 'Use tools/list to see available tools.',
 * });
 *
 * // Register tools
 * server.registerTool({
 *   tool: {
 *     name: 'hello',
 *     description: 'Say hello',
 *     inputSchema: {
 *       type: 'object',
 *       properties: { name: { type: 'string' } },
 *       required: ['name'],
 *     },
 *   },
 *   handler: async (args) => ({ message: `Hello, ${args.name}!` }),
 * });
 *
 * // Handle requests
 * const response = await server.handleRequest(jsonRpcRequest);
 * ```
 */
export class MCPServer {
  private config: MCPServerConfig
  private tools: Map<string, MCPToolDefinition> = new Map()
  private requestHandler: MCPRequestHandler

  constructor(config: MCPServerConfig) {
    this.config = config
    this.requestHandler = new MCPRequestHandler({
      getInitializeResult: this.getInitializeResult.bind(this),
      requireAuth: true,
    })
  }

  /**
   * Get server information
   */
  getServerInfo(): Implementation {
    return {
      name: this.config.name,
      version: this.config.version,
      title: this.config.title,
    }
  }

  /**
   * Get server capabilities
   */
  getServerCapabilities(): ServerCapabilities {
    return {
      tools: {
        listChanged: false, // We don't support dynamic tool list changes yet
      },
      resources: {
        subscribe: false,
        listChanged: false,
      },
      prompts: {
        listChanged: false,
      },
      logging: {},
      ...this.config.capabilities,
    }
  }

  /**
   * Get initialize result for protocol negotiation
   */
  getInitializeResult(requestedVersion: MCPProtocolVersion): InitializeResult {
    const serverInfo = this.getServerInfo()
    const capabilities = this.getServerCapabilities()

    // Negotiate protocol version (use requested if supported, otherwise default)
    const protocolVersion = MCP_PROTOCOL_VERSIONS.includes(requestedVersion)
      ? requestedVersion
      : DEFAULT_MCP_PROTOCOL_VERSION

    return {
      protocolVersion,
      capabilities,
      serverInfo,
      instructions: this.config.instructions,
    }
  }

  /**
   * Register a tool
   *
   * @param toolDef - Tool definition with handler
   */
  registerTool(toolDef: MCPToolDefinition): void {
    this.tools.set(toolDef.tool.name, toolDef)
    this.requestHandler.registerTool(toolDef)
  }

  /**
   * Register multiple tools
   *
   * @param tools - Array of tool definitions
   */
  registerTools(tools: MCPToolDefinition[]): void {
    for (const tool of tools) {
      this.registerTool(tool)
    }
  }

  /**
   * Unregister a tool
   *
   * @param name - Tool name to unregister
   * @returns true if tool was removed
   */
  unregisterTool(name: string): boolean {
    const deleted = this.tools.delete(name)
    if (deleted) {
      this.requestHandler.unregisterTool(name)
    }
    return deleted
  }

  /**
   * Get all registered tools
   */
  getTools(): MCPTool[] {
    return Array.from(this.tools.values()).map((t) => t.tool)
  }

  /**
   * Get a specific tool by name
   */
  getTool(name: string): MCPToolDefinition | undefined {
    return this.tools.get(name)
  }

  /**
   * Check if a tool is registered
   */
  hasTool(name: string): boolean {
    return this.tools.has(name)
  }

  /**
   * Get the request handler
   */
  getRequestHandler(): MCPRequestHandler {
    return this.requestHandler
  }

  /**
   * Handle a JSON-RPC request
   *
   * @param request - Raw JSON-RPC request
   * @param authContext - Optional authentication context
   */
  async handleRequest(
    request: unknown,
    authContext?: { apiKey?: string; userId?: string },
  ) {
    return this.requestHandler.handle(request, authContext)
  }

  /**
   * Set whether authentication is required for tool calls
   */
  setRequireAuth(require: boolean): void {
    // Create a new request handler with updated config
    this.requestHandler = new MCPRequestHandler({
      getInitializeResult: this.getInitializeResult.bind(this),
      tools: Array.from(this.tools.values()),
      requireAuth: require,
    })
  }
}

/**
 * Create an MCP server with tools
 *
 * @param config - Server configuration
 * @param tools - Initial tools to register
 * @returns Configured MCP server
 */
export function createMCPServer(
  config: MCPServerConfig,
  tools: MCPToolDefinition[] = [],
): MCPServer {
  const server = new MCPServer(config)
  server.registerTools(tools)
  return server
}

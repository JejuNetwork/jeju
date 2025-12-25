/**
 * Configurable MCP server with runtime tool registration.
 */

import type { AgentAuthenticator } from '../auth/agent-auth'
import {
  type MCPPromptDefinition,
  MCPRequestHandler,
  type MCPResourceDefinition,
} from '../handlers/request-handler'
import type {
  Implementation,
  InitializeResult,
  MCPAuthContext,
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
 * MCP Server configuration with authenticator
 */
export interface MCPServerOptions {
  config: MCPServerConfig
  authenticator: AgentAuthenticator
}

export class MCPServer {
  private config: MCPServerConfig
  private tools: Map<string, MCPToolDefinition> = new Map()
  private resources: Map<string, MCPResourceDefinition> = new Map()
  private prompts: Map<string, MCPPromptDefinition> = new Map()
  private requestHandler: MCPRequestHandler

  constructor(options: MCPServerOptions) {
    this.config = options.config
    this.requestHandler = new MCPRequestHandler({
      getInitializeResult: this.getInitializeResult.bind(this),
      authenticator: options.authenticator,
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
        listChanged: false,
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

    if (!MCP_PROTOCOL_VERSIONS.includes(requestedVersion)) {
      throw new Error(`Unsupported MCP protocol version: ${requestedVersion}`)
    }

    return {
      protocolVersion: requestedVersion,
      capabilities,
      serverInfo,
      instructions: this.config.instructions,
    }
  }

  /**
   * Register a tool
   */
  registerTool(toolDef: MCPToolDefinition): void {
    this.tools.set(toolDef.tool.name, toolDef)
    this.requestHandler.registerTool(toolDef)
  }

  /**
   * Register multiple tools
   */
  registerTools(tools: MCPToolDefinition[]): void {
    for (const tool of tools) {
      this.registerTool(tool)
    }
  }

  /**
   * Unregister a tool
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
   * Register a resource
   */
  registerResource(resourceDef: MCPResourceDefinition): void {
    this.resources.set(resourceDef.resource.uri, resourceDef)
    this.requestHandler.registerResource(resourceDef)
  }

  /**
   * Register a prompt
   */
  registerPrompt(promptDef: MCPPromptDefinition): void {
    this.prompts.set(promptDef.prompt.name, promptDef)
    this.requestHandler.registerPrompt(promptDef)
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
   * @param authContext - Authentication context (required)
   */
  async handleRequest(request: unknown, authContext: MCPAuthContext) {
    return this.requestHandler.handle(request, authContext)
  }
}

/**
 * Create an MCP server with tools
 *
 * @param options - Server options with config and authenticator
 * @param tools - Initial tools to register
 * @returns Configured MCP server
 */
export function createMCPServer(
  options: MCPServerOptions,
  tools: MCPToolDefinition[] = [],
): MCPServer {
  const server = new MCPServer(options)
  server.registerTools(tools)
  return server
}

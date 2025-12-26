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

export const DEFAULT_MCP_PROTOCOL_VERSION: MCPProtocolVersion = '2024-11-05'

export interface MCPServerOptions {
  config: MCPServerConfig
  authenticator: AgentAuthenticator
}

export class MCPServer {
  private config: MCPServerConfig
  private requestHandler: MCPRequestHandler

  constructor(options: MCPServerOptions) {
    this.config = options.config
    this.requestHandler = new MCPRequestHandler({
      getInitializeResult: this.getInitializeResult.bind(this),
      authenticator: options.authenticator,
    })
  }

  getServerInfo(): Implementation {
    return {
      name: this.config.name,
      version: this.config.version,
      title: this.config.title,
    }
  }

  getServerCapabilities(): ServerCapabilities {
    return {
      tools: { listChanged: false },
      resources: { subscribe: false, listChanged: false },
      prompts: { listChanged: false },
      logging: {},
      ...this.config.capabilities,
    }
  }

  getInitializeResult(requestedVersion: MCPProtocolVersion): InitializeResult {
    if (!MCP_PROTOCOL_VERSIONS.includes(requestedVersion)) {
      throw new Error(`Unsupported MCP protocol version: ${requestedVersion}`)
    }

    return {
      protocolVersion: requestedVersion,
      capabilities: this.getServerCapabilities(),
      serverInfo: this.getServerInfo(),
      instructions: this.config.instructions,
    }
  }

  registerTool(toolDef: MCPToolDefinition): void {
    this.requestHandler.registerTool(toolDef)
  }

  registerTools(tools: MCPToolDefinition[]): void {
    this.requestHandler.registerTools(tools)
  }

  unregisterTool(name: string): boolean {
    return this.requestHandler.unregisterTool(name)
  }

  getTools(): MCPTool[] {
    return this.requestHandler.getTools()
  }

  getTool(name: string): MCPToolDefinition | undefined {
    return this.requestHandler.getTool(name)
  }

  hasTool(name: string): boolean {
    return this.requestHandler.hasTool(name)
  }

  registerResource(resourceDef: MCPResourceDefinition): void {
    this.requestHandler.registerResource(resourceDef)
  }

  registerPrompt(promptDef: MCPPromptDefinition): void {
    this.requestHandler.registerPrompt(promptDef)
  }

  getRequestHandler(): MCPRequestHandler {
    return this.requestHandler
  }

  async handleRequest(request: unknown, authContext: MCPAuthContext) {
    return this.requestHandler.handle(request, authContext)
  }
}

export function createMCPServer(
  options: MCPServerOptions,
  tools: MCPToolDefinition[] = [],
): MCPServer {
  const server = new MCPServer(options)
  server.registerTools(tools)
  return server
}

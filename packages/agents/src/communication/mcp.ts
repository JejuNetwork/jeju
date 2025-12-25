/**
 * MCP Protocol Communication
 *
 * Model Context Protocol integration for agent capabilities using @jejunetwork/mcp.
 *
 * @packageDocumentation
 */

import type { MCPTool as MCPToolDef, MCPToolDefinition } from '@jejunetwork/mcp'
import { MCPServer } from '@jejunetwork/mcp'
import { logger } from '@jejunetwork/shared'

/**
 * MCP tool definition for agent use
 */
export interface MCPTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/**
 * MCP resource
 */
export interface MCPResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

/**
 * MCP client configuration
 */
export interface MCPClientConfig {
  serverEndpoint?: string
  agentId?: string
  apiKey?: string
}

/**
 * MCP Communication Client
 *
 * Connects to MCP servers and invokes tools for agent operations.
 */
export class MCPCommunicationClient {
  private serverEndpoint: string
  private agentId: string
  private apiKey: string
  private toolCache: Map<string, MCPTool> = new Map()
  private resourceCache: Map<string, MCPResource> = new Map()

  constructor(config: MCPClientConfig = {}) {
    this.serverEndpoint = config.serverEndpoint ?? ''
    this.agentId = config.agentId ?? ''
    this.apiKey = config.apiKey ?? ''
  }

  /**
   * Initialize connection to MCP server
   */
  async initialize(): Promise<void> {
    if (!this.serverEndpoint) {
      throw new Error('MCP server endpoint not configured')
    }

    logger.info(`Initializing MCP client for endpoint: ${this.serverEndpoint}`)

    // Send initialize request
    const response = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'jeju-agent',
        version: '1.0.0',
      },
    })

    if (!response) {
      throw new Error('MCP initialize failed')
    }

    logger.info('MCP client initialized')
  }

  /**
   * List available tools from the MCP server
   */
  async listTools(): Promise<MCPTool[]> {
    logger.debug(`Listing MCP tools from ${this.serverEndpoint || 'default'}`)

    if (!this.serverEndpoint) {
      return []
    }

    const response = await this.sendRequest<{ tools: MCPToolDef[] }>(
      'tools/list',
      {},
    )

    if (!response?.tools) {
      return []
    }

    const tools = response.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }))

    // Cache tools
    for (const tool of tools) {
      this.toolCache.set(tool.name, tool)
    }

    return tools
  }

  /**
   * Call a tool on the MCP server
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    logger.debug(`Calling MCP tool: ${name}`, { args })

    if (!this.serverEndpoint) {
      throw new Error('MCP server endpoint not configured')
    }

    const response = await this.sendRequest<{ content: unknown[] }>(
      'tools/call',
      {
        name,
        arguments: args,
      },
    )

    if (!response) {
      throw new Error(`MCP tool call failed: ${name}`)
    }

    // Extract result from content
    const textContent = response.content?.find(
      (c): c is { type: string; text: string } =>
        typeof c === 'object' && c !== null && 'type' in c && c.type === 'text',
    )

    if (textContent) {
      try {
        return JSON.parse(textContent.text) as Record<string, unknown>
      } catch {
        return { result: textContent.text }
      }
    }

    return { content: response.content }
  }

  /**
   * List resources from the MCP server
   */
  async listResources(): Promise<MCPResource[]> {
    logger.debug(
      `Listing MCP resources from ${this.serverEndpoint || 'default'}`,
    )

    if (!this.serverEndpoint) {
      return []
    }

    const response = await this.sendRequest<{
      resources: Array<{
        uri: string
        name: string
        description?: string
        mimeType?: string
      }>
    }>('resources/list', {})

    if (!response?.resources) {
      return []
    }

    const resources = response.resources.map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    }))

    // Cache resources
    for (const resource of resources) {
      this.resourceCache.set(resource.uri, resource)
    }

    return resources
  }

  /**
   * Read a resource from the MCP server
   */
  async readResource(uri: string): Promise<string> {
    logger.debug(`Reading MCP resource: ${uri}`)

    if (!this.serverEndpoint) {
      throw new Error('MCP server endpoint not configured')
    }

    const response = await this.sendRequest<{
      contents: Array<{ uri: string; text?: string; blob?: string }>
    }>('resources/read', { uri })

    if (!response?.contents?.[0]) {
      throw new Error(`MCP resource not found: ${uri}`)
    }

    const content = response.contents[0]
    return content.text ?? content.blob ?? ''
  }

  /**
   * Get a cached tool definition
   */
  getCachedTool(name: string): MCPTool | undefined {
    return this.toolCache.get(name)
  }

  /**
   * Get a cached resource definition
   */
  getCachedResource(uri: string): MCPResource | undefined {
    return this.resourceCache.get(uri)
  }

  /**
   * Send a JSON-RPC request to the MCP server
   */
  private async sendRequest<T>(
    method: string,
    params: Record<string, unknown>,
  ): Promise<T | null> {
    if (!this.serverEndpoint) {
      return null
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

    try {
      const response = await fetch(this.serverEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          ...(this.agentId ? { 'X-Agent-Id': this.agentId } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: requestId,
          method,
          params,
        }),
      })

      if (!response.ok) {
        throw new Error(`MCP request failed: ${response.status}`)
      }

      const json = (await response.json()) as {
        result?: T
        error?: { message: string }
      }

      if (json.error) {
        throw new Error(`MCP error: ${json.error.message}`)
      }

      return json.result ?? null
    } catch (error) {
      logger.error(`MCP request failed: ${method}`, {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }
}

/**
 * Create MCP client
 */
export function createMCPClient(
  config: MCPClientConfig = {},
): MCPCommunicationClient {
  return new MCPCommunicationClient(config)
}

/**
 * Create an MCP server for an agent to expose tools
 */
export function createAgentMCPServer(
  agentId: string,
  tools: MCPToolDefinition[] = [],
): MCPServer {
  const server = new MCPServer({
    name: `jeju-agent-${agentId}`,
    version: '1.0.0',
    title: `Jeju Agent ${agentId}`,
  })

  server.registerTools(tools)

  return server
}

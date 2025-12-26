/**
 * JSON-RPC 2.0 request handler for MCP protocol methods.
 */

import { JsonValueSchema } from '@jejunetwork/types'
import { z } from 'zod'
import type { AgentAuthenticator } from '../auth/agent-auth'
import type {
  AuthenticatedAgent,
  InitializeResult,
  JsonRpcError,
  JsonRpcResponse,
  JsonValue,
  MCPAuthContext,
  MCPPrompt,
  MCPProtocolVersion,
  MCPResource,
  MCPTool,
  MCPToolDefinition,
  PromptsGetResult,
  PromptsListResult,
  ResourcesListResult,
  ResourcesReadResult,
  StringRecord,
  ToolCallResult,
  ToolsListResult,
} from '../types/mcp'
import { MCP_PROTOCOL_VERSIONS, MCPMethod } from '../types/mcp'

// JSON-RPC 2.0 Request Validation Schema
const JsonRpcRequestSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    method: z.string().min(1),
    params: z.record(z.string(), JsonValueSchema).optional(),
    id: z.union([z.string(), z.number()]),
  })
  .strict()

type ValidatedJsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>

// MCP Protocol versions as a const tuple for Zod enum
const PROTOCOL_VERSIONS_TUPLE = MCP_PROTOCOL_VERSIONS as readonly [
  string,
  ...string[],
]

// Initialize Params Validation Schema
const InitializeParamsSchema = z
  .object({
    protocolVersion: z.enum(PROTOCOL_VERSIONS_TUPLE),
    capabilities: z
      .object({
        roots: z
          .object({ listChanged: z.boolean().optional() })
          .strict()
          .optional(),
        sampling: z.record(z.string(), JsonValueSchema).optional(),
        tools: z
          .object({ listChanged: z.boolean().optional() })
          .strict()
          .optional(),
        prompts: z
          .object({ listChanged: z.boolean().optional() })
          .strict()
          .optional(),
        resources: z
          .object({
            subscribe: z.boolean().optional(),
            listChanged: z.boolean().optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    clientInfo: z
      .object({
        name: z.string().min(1),
        version: z.string().min(1),
        title: z.string().optional(),
      })
      .strict(),
  })
  .strict()

// Tool Call Params Validation Schema
const ToolCallParamsSchema = z
  .object({
    name: z.string().min(1),
    arguments: z.record(z.string(), JsonValueSchema),
  })
  .strict()

// Resource Read Params Validation Schema
const ResourceReadParamsSchema = z
  .object({
    uri: z.string().min(1),
  })
  .strict()

// Prompt Get Params Validation Schema
const PromptGetParamsSchema = z
  .object({
    name: z.string().min(1),
    arguments: z.record(z.string(), JsonValueSchema).optional(),
  })
  .strict()

/**
 * Get initialize result generator type
 */
export type GetInitializeResultFn = (
  requestedVersion: MCPProtocolVersion,
) => InitializeResult

/**
 * MCP Resource handler definition
 */
export interface MCPResourceDefinition {
  resource: MCPResource
  handler: (uri: string, agent: AuthenticatedAgent) => Promise<string>
}

/**
 * MCP Prompt handler definition
 */
export interface MCPPromptDefinition {
  prompt: MCPPrompt
  handler: (
    args: StringRecord<JsonValue>,
    agent: AuthenticatedAgent,
  ) => Promise<string>
}

/**
 * MCP Request Handler Options
 */
export interface MCPRequestHandlerOptions {
  getInitializeResult: GetInitializeResultFn
  authenticator: AgentAuthenticator
  tools?: MCPToolDefinition[]
  resources?: MCPResourceDefinition[]
  prompts?: MCPPromptDefinition[]
}

/**
 * MCP Request Handler
 *
 * Processes JSON-RPC 2.0 requests and routes to appropriate handlers.
 * Authentication is required for all operations except initialize and ping.
 */
export class MCPRequestHandler {
  private tools: Map<string, MCPToolDefinition> = new Map()
  private resources: Map<string, MCPResourceDefinition> = new Map()
  private prompts: Map<string, MCPPromptDefinition> = new Map()
  private getInitializeResult: GetInitializeResultFn
  private authenticator: AgentAuthenticator

  constructor(options: MCPRequestHandlerOptions) {
    this.getInitializeResult = options.getInitializeResult
    this.authenticator = options.authenticator

    if (options.tools) {
      for (const tool of options.tools) {
        this.registerTool(tool)
      }
    }

    if (options.resources) {
      for (const resource of options.resources) {
        this.registerResource(resource)
      }
    }

    if (options.prompts) {
      for (const prompt of options.prompts) {
        this.registerPrompt(prompt)
      }
    }
  }

  /**
   * Register a tool
   */
  registerTool(toolDef: MCPToolDefinition): void {
    this.tools.set(toolDef.tool.name, toolDef)
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
    return this.tools.delete(name)
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
  }

  /**
   * Get all registered resources
   */
  getResources(): MCPResource[] {
    return Array.from(this.resources.values()).map((r) => r.resource)
  }

  /**
   * Register a prompt
   */
  registerPrompt(promptDef: MCPPromptDefinition): void {
    this.prompts.set(promptDef.prompt.name, promptDef)
  }

  /**
   * Get all registered prompts
   */
  getPrompts(): MCPPrompt[] {
    return Array.from(this.prompts.values()).map((p) => p.prompt)
  }

  /**
   * Validate and handle JSON-RPC request
   *
   * @param rawRequest - The raw request object (before validation)
   * @param authContext - Authentication context (passed through, not stored)
   */
  async handle(
    rawRequest: unknown,
    authContext: MCPAuthContext,
  ): Promise<JsonRpcResponse> {
    // Validate JSON-RPC request structure
    const parseResult = JsonRpcRequestSchema.safeParse(rawRequest)
    if (!parseResult.success) {
      const requestId = this.extractRequestId(rawRequest)
      return this.createErrorResponse(
        requestId,
        -32600,
        `Invalid JSON-RPC request: ${parseResult.error.message}`,
      )
    }

    const request = parseResult.data

    // Route to appropriate handler based on method
    switch (request.method) {
      case MCPMethod.INITIALIZE:
        return this.handleInitialize(request)
      case MCPMethod.PING:
        return this.handlePing(request)
      case MCPMethod.TOOLS_LIST:
        return this.handleToolsList(request)
      case MCPMethod.TOOLS_CALL:
        return this.handleToolsCall(request, authContext)
      case MCPMethod.RESOURCES_LIST:
        return this.handleResourcesList(request)
      case MCPMethod.RESOURCES_READ:
        return this.handleResourcesRead(request, authContext)
      case MCPMethod.PROMPTS_LIST:
        return this.handlePromptsList(request)
      case MCPMethod.PROMPTS_GET:
        return this.handlePromptsGet(request, authContext)
      default:
        return this.createErrorResponse(
          request.id,
          -32601,
          `Method not found: ${request.method}`,
        )
    }
  }

  /**
   * Handle initialize request with proper validation
   */
  private handleInitialize(request: ValidatedJsonRpcRequest): JsonRpcResponse {
    const parseResult = InitializeParamsSchema.safeParse(request.params)

    if (!parseResult.success) {
      return this.createErrorResponse(
        request.id,
        -32602,
        `Invalid initialize params: ${parseResult.error.message}`,
      )
    }

    const params = parseResult.data

    const result = this.getInitializeResult(
      params.protocolVersion as MCPProtocolVersion,
    )

    return {
      jsonrpc: '2.0',
      id: request.id,
      result,
    }
  }

  /**
   * Handle ping request
   */
  private handlePing(request: ValidatedJsonRpcRequest): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {},
    }
  }

  /**
   * Handle tools/list request
   */
  private handleToolsList(request: ValidatedJsonRpcRequest): JsonRpcResponse {
    const tools = this.getTools()
    const result: ToolsListResult = { tools }

    return {
      jsonrpc: '2.0',
      id: request.id,
      result,
    }
  }

  /**
   * Handle tools/call request with proper validation
   */
  private async handleToolsCall(
    request: ValidatedJsonRpcRequest,
    authContext: MCPAuthContext,
  ): Promise<JsonRpcResponse> {
    // Authenticate agent - required for all tool calls
    const agent = await this.authenticateRequest(authContext)
    if (!agent) {
      return this.createErrorResponse(
        request.id,
        -32001,
        'Authentication failed',
      )
    }

    const parseResult = ToolCallParamsSchema.safeParse(request.params)

    if (!parseResult.success) {
      return this.createErrorResponse(
        request.id,
        -32602,
        `Invalid tool call params: ${parseResult.error.message}`,
      )
    }

    const params = parseResult.data

    // Find and execute tool
    const toolDef = this.tools.get(params.name)
    if (!toolDef) {
      return this.createErrorResponse(
        request.id,
        -32602,
        `Unknown tool: ${params.name}`,
      )
    }

    // Validate arguments if validator exists
    let validatedArgs: StringRecord<JsonValue> = params.arguments
    if (toolDef.validator) {
      try {
        const validated = toolDef.validator(params.arguments)
        validatedArgs = validated as StringRecord<JsonValue>
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        return this.createErrorResponse(
          request.id,
          -32602,
          `Invalid arguments for ${params.name}: ${errorMessage}`,
        )
      }
    }

    // Execute tool
    const toolResult = await toolDef.handler(validatedArgs, agent)

    // Convert tool result to MCP content format
    const content = this.convertToolResultToContent(toolResult as JsonValue)

    const result: ToolCallResult = {
      content,
      isError: false,
    }

    return {
      jsonrpc: '2.0',
      id: request.id,
      result,
    }
  }

  /**
   * Handle resources/list request
   */
  private handleResourcesList(
    request: ValidatedJsonRpcRequest,
  ): JsonRpcResponse {
    const resources = this.getResources()
    const result: ResourcesListResult = { resources }
    return {
      jsonrpc: '2.0',
      id: request.id,
      result,
    }
  }

  /**
   * Handle resources/read request
   */
  private async handleResourcesRead(
    request: ValidatedJsonRpcRequest,
    authContext: MCPAuthContext,
  ): Promise<JsonRpcResponse> {
    const agent = await this.authenticateRequest(authContext)
    if (!agent) {
      return this.createErrorResponse(
        request.id,
        -32001,
        'Authentication failed',
      )
    }

    const parseResult = ResourceReadParamsSchema.safeParse(request.params)
    if (!parseResult.success) {
      return this.createErrorResponse(
        request.id,
        -32602,
        `Invalid resource read params: ${parseResult.error.message}`,
      )
    }

    const { uri } = parseResult.data
    const resourceDef = this.resources.get(uri)

    if (!resourceDef) {
      return this.createErrorResponse(
        request.id,
        -32602,
        `Unknown resource: ${uri}`,
      )
    }

    const text = await resourceDef.handler(uri, agent)
    const mimeType = resourceDef.resource.mimeType || 'text/plain'

    const result: ResourcesReadResult = {
      contents: [{ uri, mimeType, text }],
    }

    return {
      jsonrpc: '2.0',
      id: request.id,
      result,
    }
  }

  /**
   * Handle prompts/list request
   */
  private handlePromptsList(request: ValidatedJsonRpcRequest): JsonRpcResponse {
    const prompts = this.getPrompts()
    const result: PromptsListResult = { prompts }
    return {
      jsonrpc: '2.0',
      id: request.id,
      result,
    }
  }

  /**
   * Handle prompts/get request
   */
  private async handlePromptsGet(
    request: ValidatedJsonRpcRequest,
    authContext: MCPAuthContext,
  ): Promise<JsonRpcResponse> {
    const agent = await this.authenticateRequest(authContext)
    if (!agent) {
      return this.createErrorResponse(
        request.id,
        -32001,
        'Authentication failed',
      )
    }

    const parseResult = PromptGetParamsSchema.safeParse(request.params)
    if (!parseResult.success) {
      return this.createErrorResponse(
        request.id,
        -32602,
        `Invalid prompt get params: ${parseResult.error.message}`,
      )
    }

    const { name, arguments: promptArgs } = parseResult.data
    const promptDef = this.prompts.get(name)

    if (!promptDef) {
      return this.createErrorResponse(
        request.id,
        -32602,
        `Unknown prompt: ${name}`,
      )
    }

    const handlerArgs = promptArgs || {}
    const text = await promptDef.handler(handlerArgs, agent)

    const result: PromptsGetResult = {
      description: promptDef.prompt.description,
      messages: [
        {
          role: 'user',
          content: { type: 'text', text },
        },
      ],
    }

    return {
      jsonrpc: '2.0',
      id: request.id,
      result,
    }
  }

  /**
   * Authenticate request using the configured authenticator
   */
  private async authenticateRequest(
    authContext: MCPAuthContext,
  ): Promise<AuthenticatedAgent | null> {
    if (!authContext.apiKey) {
      return null
    }

    return this.authenticator.authenticate({ apiKey: authContext.apiKey })
  }

  /**
   * Convert tool result to MCP content format
   */
  private convertToolResultToContent(
    toolResult: JsonValue,
  ): Array<{ type: 'text'; text: string }> {
    if (typeof toolResult === 'string') {
      return [{ type: 'text' as const, text: toolResult }]
    }

    if (typeof toolResult === 'object' && toolResult !== null) {
      const formatted = JSON.stringify(toolResult, null, 2)
      return [{ type: 'text' as const, text: formatted }]
    }

    return [{ type: 'text' as const, text: String(toolResult) }]
  }

  /**
   * Extract request ID from raw request for error responses
   */
  private extractRequestId(rawRequest: unknown): string | number | null {
    if (
      typeof rawRequest === 'object' &&
      rawRequest !== null &&
      'id' in rawRequest
    ) {
      const idValue = (rawRequest as Record<string, unknown>).id
      if (typeof idValue === 'string' || typeof idValue === 'number') {
        return idValue
      }
    }
    return null
  }

  /**
   * Create JSON-RPC error response
   */
  private createErrorResponse(
    id: string | number | null,
    code: number,
    message: string,
    data?: JsonValue,
  ): JsonRpcResponse {
    const error: JsonRpcError = { code, message, data }
    return { jsonrpc: '2.0', id, error }
  }
}

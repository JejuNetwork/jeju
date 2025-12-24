/**
 * JSON-RPC 2.0 request handler for MCP protocol methods.
 */

import { z } from 'zod'
import { authenticateAgent } from '../auth/agent-auth'
import type {
  AuthenticatedAgent,
  InitializeResult,
  JsonRpcError,
  JsonRpcResponse,
  JsonValue,
  MCPAuthContext,
  MCPProtocolVersion,
  MCPTool,
  MCPToolDefinition,
  StringRecord,
  ToolCallResult,
  ToolsListResult,
} from '../types/mcp'
import { MCP_PROTOCOL_VERSIONS, MCPMethod } from '../types/mcp'
import { JsonValueSchema } from '../utils/tool-args-validation'

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

/**
 * Get initialize result generator type
 */
export type GetInitializeResultFn = (
  requestedVersion: MCPProtocolVersion,
) => InitializeResult

/**
 * MCP Request Handler
 *
 * Processes JSON-RPC 2.0 requests and routes to appropriate handlers.
 * This is a generalized handler that accepts tools as configuration.
 */
export class MCPRequestHandler {
  private authContext: MCPAuthContext | undefined
  private tools: Map<string, MCPToolDefinition> = new Map()
  private getInitializeResult: GetInitializeResultFn
  private requireAuth: boolean

  constructor(options: {
    getInitializeResult: GetInitializeResultFn
    tools?: MCPToolDefinition[]
    requireAuth?: boolean
  }) {
    this.getInitializeResult = options.getInitializeResult
    this.requireAuth = options.requireAuth ?? true

    if (options.tools) {
      for (const tool of options.tools) {
        this.registerTool(tool)
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
   * Validate and handle JSON-RPC request
   *
   * @param rawRequest - The raw request object (before validation)
   * @param authContext - Optional authentication context
   */
  async handle(
    rawRequest: unknown,
    authContext?: MCPAuthContext,
  ): Promise<JsonRpcResponse> {
    // Store auth context if provided
    if (authContext !== undefined) {
      this.authContext = authContext
    }

    // Validate JSON-RPC request structure
    const parseResult = JsonRpcRequestSchema.safeParse(rawRequest)
    if (!parseResult.success) {
      // Try to extract request ID for error response (per JSON-RPC spec)
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
        return this.handleToolsCall(request)
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

    // Get initialize result with validated protocol version
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
  ): Promise<JsonRpcResponse> {
    // Require authentication for tool calls if configured
    if (this.requireAuth && !this.authContext) {
      return this.createErrorResponse(
        request.id,
        -32000,
        'Authentication required',
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

    // Authenticate agent if auth context is present
    let agent: AuthenticatedAgent | undefined
    if (this.authContext?.apiKey) {
      const authResult = await authenticateAgent({
        apiKey: this.authContext.apiKey,
      })

      if (authResult) {
        agent = authResult
      } else if (this.requireAuth) {
        return this.createErrorResponse(
          request.id,
          -32001,
          'Authentication failed',
        )
      }
    }

    // For non-auth mode, create a dummy agent
    if (agent === undefined && !this.requireAuth) {
      agent = { userId: 'anonymous', agentId: 'anonymous' }
    }

    if (agent === undefined) {
      return this.createErrorResponse(
        request.id,
        -32001,
        'Authentication failed',
      )
    }

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
        validatedArgs = toolDef.validator(
          params.arguments,
        ) as StringRecord<JsonValue>
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
    // Tool results should be JSON-serializable by contract
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
   * Convert tool result to MCP content format
   */
  private convertToolResultToContent(
    toolResult: JsonValue,
  ): Array<{ type: 'text'; text: string }> {
    // Handle different result types
    if (typeof toolResult === 'string') {
      return [{ type: 'text' as const, text: toolResult }]
    }

    if (typeof toolResult === 'object' && toolResult !== null) {
      // Format object results as readable JSON
      const formatted = JSON.stringify(toolResult, null, 2)
      return [{ type: 'text' as const, text: formatted }]
    }

    // Primitive types: convert to string representation
    return [{ type: 'text' as const, text: String(toolResult) }]
  }

  /**
   * Extract request ID from raw request for error responses
   * Returns null if ID cannot be extracted (per JSON-RPC spec)
   */
  private extractRequestId(
    rawRequest: Record<string, unknown> | unknown,
  ): string | number | null {
    if (
      typeof rawRequest === 'object' &&
      rawRequest !== null &&
      'id' in rawRequest
    ) {
      const idValue = (rawRequest as { id: unknown }).id
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

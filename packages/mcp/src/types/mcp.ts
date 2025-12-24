/**
 * MCP Protocol Type Definitions
 * Model Context Protocol types following JSON-RPC 2.0 spec
 *
 * @packageDocumentation
 */

/**
 * JSON value types supported by JSON-RPC
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

/**
 * String-keyed record type for JSON objects
 */
export type StringRecord<T> = Record<string, T>

/**
 * JSON-RPC 2.0 Error
 */
export interface JsonRpcError {
  code: number
  message: string
  data?: JsonValue
}

/**
 * JSON-RPC 2.0 Request parameters
 */
export type JsonRpcParams = StringRecord<JsonValue>

/**
 * JSON-RPC 2.0 Request
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  method: string
  params?: JsonRpcParams
  id: string | number
}

/**
 * JSON-RPC 2.0 Notification (request without id)
 */
export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: JsonRpcParams
}

/**
 * JSON-RPC 2.0 Result - union of all valid MCP result types
 * Defined as a union to avoid unsafe casts in request handlers
 */
export type JsonRpcResult =
  | JsonValue
  | InitializeResult
  | ToolsListResult
  | ToolCallResult
  | Record<string, never> // Empty object for ping

/**
 * JSON-RPC 2.0 Response
 */
export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: JsonRpcResult
  error?: JsonRpcError
}

export enum MCPMethod {
  INITIALIZE = 'initialize',
  PING = 'ping',
  TOOLS_LIST = 'tools/list',
  TOOLS_CALL = 'tools/call',
  RESOURCES_LIST = 'resources/list',
  RESOURCES_READ = 'resources/read',
  PROMPTS_LIST = 'prompts/list',
  PROMPTS_GET = 'prompts/get',
}

// MCP Protocol Versions
export const MCP_PROTOCOL_VERSIONS = [
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
] as const

export type MCPProtocolVersion = (typeof MCP_PROTOCOL_VERSIONS)[number]

/**
 * Client Capabilities
 */
export interface ClientCapabilities {
  roots?: {
    listChanged?: boolean
  }
  sampling?: StringRecord<JsonValue>
  tools?: {
    listChanged?: boolean
  }
  prompts?: {
    listChanged?: boolean
  }
  resources?: {
    subscribe?: boolean
    listChanged?: boolean
  }
}

/**
 * Server Capabilities
 */
export interface ServerCapabilities {
  logging?: StringRecord<JsonValue>
  prompts?: {
    listChanged?: boolean
  }
  resources?: {
    subscribe?: boolean
    listChanged?: boolean
  }
  tools?: {
    listChanged?: boolean
  }
}

/**
 * Implementation Info
 */
export interface Implementation {
  name: string
  version: string
  title?: string
}

/**
 * Initialize Request Params
 */
export interface InitializeParams {
  protocolVersion: MCPProtocolVersion
  capabilities: ClientCapabilities
  clientInfo: Implementation
}

/**
 * Initialize Result
 */
export interface InitializeResult {
  protocolVersion: MCPProtocolVersion
  capabilities: ServerCapabilities
  serverInfo: Implementation
  instructions?: string
}

/**
 * Tool Input Schema Property
 */
export interface MCPToolInputSchemaProperty {
  type: string
  description?: string
  enum?: readonly string[]
  default?: JsonValue
  properties?: StringRecord<MCPToolInputSchemaProperty>
  items?: MCPToolInputSchemaProperty
  required?: string[]
}

/**
 * MCP Tool Definition
 */
export interface MCPTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: StringRecord<MCPToolInputSchemaProperty>
    required?: string[]
  }
}

/**
 * Tools List Result
 */
export interface ToolsListResult {
  tools: MCPTool[]
  nextCursor?: string
}

/**
 * Tool Call Params
 */
export interface ToolCallParams {
  name: string
  arguments: StringRecord<JsonValue>
}

/**
 * Text content for tool results
 */
export interface TextContent {
  type: 'text'
  text: string
  mimeType?: string
}

/**
 * Image content for tool results
 */
export interface ImageContent {
  type: 'image'
  data: string // base64
  mimeType: string
}

/**
 * Resource content for tool results
 */
export interface ResourceContent {
  type: 'resource'
  resource: {
    uri: string
    name?: string
    title?: string
    mimeType?: string
    text?: string
    blob?: string // base64
  }
}

/**
 * Union of all tool result content types
 */
export type ToolResultContent = TextContent | ImageContent | ResourceContent

/**
 * Tool Call Result
 */
export interface ToolCallResult {
  content: ToolResultContent[]
  isError?: boolean
}

/**
 * Authenticated Agent context (for internal use)
 */
export interface AuthenticatedAgent {
  agentId: string
  userId: string
}

/**
 * Authentication context (handled via headers)
 */
export interface MCPAuthContext {
  apiKey?: string
  userId?: string // Set after authentication
}

/**
 * Tool handler function type
 */
export type ToolHandler<
  TArgs = StringRecord<JsonValue>,
  TResult = JsonValue,
> = (args: TArgs, agent: AuthenticatedAgent) => Promise<TResult>

/**
 * Tool definition with handler
 */
export interface MCPToolDefinition<
  TArgs = StringRecord<JsonValue>,
  TResult = JsonValue,
> {
  tool: MCPTool
  handler: ToolHandler<TArgs, TResult>
  validator?: (args: unknown) => TArgs
}

/**
 * Server configuration options
 */
export interface MCPServerConfig {
  name: string
  version: string
  title?: string
  instructions?: string
  capabilities?: Partial<ServerCapabilities>
}

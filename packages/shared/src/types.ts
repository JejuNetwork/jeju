/**
 * Shared Type Definitions
 * 
 * Common types used across the shared package.
 */

// ============================================================================
// SQL Types
// ============================================================================

/**
 * Valid SQL parameter types for query binding.
 * Used throughout database operations.
 */
export type SqlParam = string | number | boolean | null | Uint8Array | bigint | Date;

/**
 * Valid SQL default value types for column definitions.
 */
export type SqlDefaultValue = string | number | boolean | null;

/**
 * Generic record type for database rows.
 */
export type SqlRow = Record<string, SqlParam | SqlDefaultValue>;

// ============================================================================
// JSON-RPC Types
// ============================================================================

/**
 * Valid JSON-RPC request ID per spec (string, number, or null).
 */
export type JsonRpcId = string | number | null;

/**
 * Valid JSON-RPC parameter types.
 */
export type RpcParam = string | number | boolean | null | RpcParam[] | { [key: string]: RpcParam };

/**
 * JSON-RPC error object.
 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: RpcParam;
}

/**
 * JSON-RPC request structure.
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: RpcParam[] | Record<string, RpcParam>;
  id: JsonRpcId;
}

/**
 * JSON-RPC response structure.
 */
export interface JsonRpcResponse<T = RpcParam> {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: T;
  error?: JsonRpcError;
}

// ============================================================================
// Protocol Data Types
// ============================================================================

/**
 * Generic protocol data object.
 * Used for A2A skill params, MCP tool arguments, etc.
 */
export type ProtocolData = Record<string, ProtocolValue>;

/**
 * Valid values in protocol data objects.
 */
export type ProtocolValue = 
  | string 
  | number 
  | boolean 
  | null 
  | ProtocolValue[] 
  | { [key: string]: ProtocolValue };

/**
 * Webhook request body type.
 */
export type WebhookBody = Record<string, ProtocolValue>;

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type { Address, Hex } from 'viem';

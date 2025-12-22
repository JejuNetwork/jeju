/**
 * @packageDocumentation
 * @module @jejunetwork/mcp
 *
 * MCP Protocol Implementation for Jeju Network
 *
 * This package provides a generalized Model Context Protocol (MCP) server implementation
 * following the JSON-RPC 2.0 specification. It provides a framework for building
 * MCP servers with configurable tools.
 *
 * @example
 * ```typescript
 * import { MCPServer, createToolHandler } from '@jejunetwork/mcp';
 * import { z } from 'zod';
 *
 * // Create server
 * const server = new MCPServer({
 *   name: 'My MCP Server',
 *   version: '1.0.0',
 *   instructions: 'Use tools/list to discover available tools.',
 * });
 *
 * // Define a tool with Zod schema
 * const getUserTool = createToolHandler(
 *   'get_user',
 *   'Get user by ID',
 *   z.object({ userId: z.string() }),
 *   async (args, agent) => {
 *     return { id: args.userId, name: 'User' };
 *   }
 * );
 *
 * // Register tool
 * server.registerTool(getUserTool);
 *
 * // Handle requests
 * const response = await server.handleRequest({
 *   jsonrpc: '2.0',
 *   method: 'tools/list',
 *   id: 1
 * });
 * ```
 *
 * @see {@link https://modelcontextprotocol.io | MCP Specification}
 */

export * from './auth'
export * from './handlers'
export * from './server'
export * from './types'
export * from './utils'

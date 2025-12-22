/**
 * MCP (Model Context Protocol) Routes
 */

import { Elysia } from 'elysia'
import { createAutocratMCPServer } from '../mcp-server'
import { blockchain, config } from '../shared-state'

const mcpServer = createAutocratMCPServer(config, blockchain)

// Get the native Elysia router and mount it directly
export const mcpRoutes = new Elysia({ prefix: '/mcp' }).use(
  mcpServer.getRouter(),
)

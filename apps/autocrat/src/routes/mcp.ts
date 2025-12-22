/**
 * MCP (Model Context Protocol) Routes
 */

import { Elysia, t } from 'elysia'
import { createAutocratMCPServer } from '../mcp-server'
import { blockchain, config } from '../shared-state'

const mcpServer = createAutocratMCPServer(config, blockchain)
const honoRouter = mcpServer.getRouter()

export const mcpRoutes = new Elysia({ prefix: '/mcp' })
  .get('/', async () => {
    const response = await honoRouter.fetch(
      new Request('http://localhost/mcp', { method: 'GET' }),
    )
    return response.json()
  })
  .post(
    '/',
    async ({ body }) => {
      const response = await honoRouter.fetch(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      )
      return response.json()
    },
    {
      body: t.Any(),
      detail: { tags: ['mcp'], summary: 'MCP JSON-RPC endpoint' },
    },
  )
  .get('/tools', async () => {
    const response = await honoRouter.fetch(
      new Request('http://localhost/mcp/tools', { method: 'GET' }),
    )
    return response.json()
  })
  .get('/resources', async () => {
    const response = await honoRouter.fetch(
      new Request('http://localhost/mcp/resources', { method: 'GET' }),
    )
    return response.json()
  })

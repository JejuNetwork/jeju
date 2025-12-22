/**
 * A2A (Agent-to-Agent) Protocol Routes
 */

import { Elysia, t } from 'elysia'
import { createAutocratA2AServer } from '../a2a-server'
import { blockchain, config } from '../server'

const a2aServer = createAutocratA2AServer(config, blockchain)

// Get the Hono router and wrap it for Elysia
const honoRouter = a2aServer.getRouter()

export const a2aRoutes = new Elysia({ prefix: '/a2a' })
  .get('/', async () => {
    const response = await honoRouter.fetch(
      new Request('http://localhost/a2a', { method: 'GET' }),
    )
    return response.json()
  })
  .get('/.well-known/agent-card.json', async () => {
    const response = await honoRouter.fetch(
      new Request('http://localhost/a2a/.well-known/agent-card.json', {
        method: 'GET',
      }),
    )
    return response.json()
  })
  .post(
    '/',
    async ({ body }) => {
      const response = await honoRouter.fetch(
        new Request('http://localhost/a2a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      )
      return response.json()
    },
    {
      body: t.Object({
        jsonrpc: t.Literal('2.0'),
        method: t.String(),
        params: t.Optional(t.Any()),
        id: t.Union([t.String(), t.Number()]),
      }),
      detail: { tags: ['a2a'], summary: 'A2A JSON-RPC endpoint' },
    },
  )
  // Redirect well-known from root
  .get('/.well-known/agent-card.json', async ({ redirect }) => {
    return redirect('/a2a/.well-known/agent-card.json')
  })

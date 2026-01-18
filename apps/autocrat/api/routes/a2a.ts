import { Elysia } from 'elysia'
import { createAutocratA2AServer } from '../a2a-server'
import { blockchain, config } from '../shared-state'

const a2aServer = createAutocratA2AServer(config, blockchain)

// Get the native Elysia router and mount it directly
export const a2aRoutes = new Elysia({ prefix: '/a2a' })
  .get('/', () => ({
    service: 'autocrat-a2a',
    protocol: 'A2A (Agent-to-Agent)',
    version: '1.0.0',
    endpoints: {
      agentCard: '/.well-known/agent-card.json',
      health: '/health',
      message: 'POST /',
    },
    description:
      'A2A endpoint for AI agent communication. Send JSON-RPC requests via POST.',
  }))
  .use(a2aServer.getRouter())

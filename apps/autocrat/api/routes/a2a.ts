/**
 * A2A (Agent-to-Agent) Protocol Routes
 */

import { Elysia } from 'elysia'
import { createAutocratA2AServer } from '../a2a-server'
import { blockchain, config } from '../shared-state'

const a2aServer = createAutocratA2AServer(config, blockchain)

// Get the native Elysia router and mount it directly
export const a2aRoutes = new Elysia({ prefix: '/a2a' }).use(
  a2aServer.getRouter(),
)

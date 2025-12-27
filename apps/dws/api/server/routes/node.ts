/**
 * Node Management Router
 *
 * Manages DWS compute node registration, status, and configuration.
 */

import { Elysia } from 'elysia'

export function createNodeRouter() {
  return new Elysia({ prefix: '/v1/nodes' })
    .get('/', () => {
      return { nodes: [], count: 0 }
    })
    .get('/health', () => {
      return { status: 'healthy' }
    })
}

/**
 * Proxy Coordinator
 * Manages distributed proxy network coordination for DWS
 */

import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'

function getCorsConfig() {
  const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',').filter(Boolean)
  const isProduction = process.env.NODE_ENV === 'production'
  return {
    origin: isProduction && CORS_ORIGINS?.length ? CORS_ORIGINS : true,
    credentials: true,
  }
}

interface ProxyNode {
  id: string
  address: string
  region: string
  capacity: number
  currentLoad: number
  lastHeartbeat: number
}

const nodes: Map<string, ProxyNode> = new Map()

const app = new Elysia()
  .use(cors(getCorsConfig()))
  .get('/health', () => ({
    status: 'healthy',
    service: 'proxy-coordinator',
    nodeCount: nodes.size,
  }))
  .get('/api/v1/nodes', () => ({
    nodes: Array.from(nodes.values()),
  }))
  .post('/api/v1/nodes/register', ({ body }) => {
    const node = body as ProxyNode
    node.lastHeartbeat = Date.now()
    nodes.set(node.id, node)
    return { success: true, nodeId: node.id }
  })
  .post('/api/v1/nodes/:nodeId/heartbeat', ({ params }) => {
    const node = nodes.get(params.nodeId)
    if (node) {
      node.lastHeartbeat = Date.now()
      return { success: true }
    }
    return { success: false, error: 'Node not found' }
  })
  .delete('/api/v1/nodes/:nodeId', ({ params }) => {
    nodes.delete(params.nodeId)
    return { success: true }
  })
  .get('/api/v1/route', ({ query }) => {
    // Find best proxy node for request
    const region = query.region as string | undefined
    const availableNodes = Array.from(nodes.values())
      .filter((n) => Date.now() - n.lastHeartbeat < 30_000) // Only active nodes
      .filter((n) => n.currentLoad < n.capacity)
      .filter((n) => !region || n.region === region)
      .sort((a, b) => a.currentLoad / a.capacity - b.currentLoad / b.capacity)

    if (availableNodes.length === 0) {
      return { success: false, error: 'No available proxy nodes' }
    }

    return {
      success: true,
      node: availableNodes[0],
    }
  })

export type ProxyCoordinatorApp = typeof app

// Start server if run directly
if (import.meta.main) {
  const PORT = Number(process.env.PROXY_COORDINATOR_PORT ?? 4020)
  app.listen(PORT)
  console.log(`Proxy Coordinator running on port ${PORT}`)
}

export { app }

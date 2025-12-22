/**
 * DWS Proxy Coordinator
 * Decentralized bandwidth marketplace coordinator
 */

import { cors } from '@elysiajs/cors'
import { Elysia, t } from 'elysia'

// ============================================================================
// CORS Configuration
// ============================================================================

function getCorsConfig() {
  const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',').filter(Boolean)
  const isProduction = process.env.NODE_ENV === 'production'
  return {
    origin: isProduction && CORS_ORIGINS?.length ? CORS_ORIGINS : true,
    credentials: true,
  }
}

export interface ProxyNode {
  id: string
  address: string
  region: string
  capacity: number
  currentLoad: number
  lastSeen: number
  healthy: boolean
}

const nodes = new Map<string, ProxyNode>()

const app = new Elysia()
  .use(cors(getCorsConfig()))
  .get('/health', () => ({
    status: 'healthy',
    service: 'dws-proxy-coordinator',
    nodes: nodes.size,
  }))
  .get('/nodes', () => {
    const activeNodes = Array.from(nodes.values()).filter(
      (n) => n.healthy && Date.now() - n.lastSeen < 60000,
    )
    return { nodes: activeNodes }
  })
  .post(
    '/nodes/register',
    ({ body }) => {
      const req = body as {
        id: string
        address: string
        region: string
        capacity: number
      }
      const node: ProxyNode = {
        ...req,
        currentLoad: 0,
        lastSeen: Date.now(),
        healthy: true,
      }
      nodes.set(req.id, node)
      return { success: true, node }
    },
    {
      body: t.Object({
        id: t.String(),
        address: t.String(),
        region: t.String(),
        capacity: t.Number(),
      }),
    },
  )
  .post('/nodes/:id/heartbeat', ({ params, set }) => {
    const node = nodes.get(params.id)
    if (!node) {
      set.status = 404
      return { error: 'Node not found' }
    }
    node.lastSeen = Date.now()
    node.healthy = true
    return { success: true }
  })
  .get('/route', ({ query }) => {
    const region = (query.region as string) || 'US'
    const activeNodes = Array.from(nodes.values())
      .filter((n) => n.healthy && Date.now() - n.lastSeen < 60000)
      .sort((a, b) => {
        if (a.region === region && b.region !== region) return -1
        if (b.region === region && a.region !== region) return 1
        return a.currentLoad - b.currentLoad
      })
    if (activeNodes.length === 0) return { error: 'No available nodes' }
    return { node: activeNodes[0] }
  })

const PORT = parseInt(process.env.PROXY_COORDINATOR_PORT || '4020', 10)

if (import.meta.main) {
  console.log(`[DWS Proxy Coordinator] Running at http://localhost:${PORT}`)
  app.listen(PORT)
}

export type ProxyCoordinatorApp = typeof app
export { app as coordinatorApp }

/**
 * DWS Proxy Coordinator
 * Decentralized bandwidth marketplace coordinator
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()
// SECURITY: Configure CORS based on environment
const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',').filter(Boolean)
const isProduction = process.env.NODE_ENV === 'production'
app.use(
  '/*',
  cors({
    origin: isProduction && CORS_ORIGINS?.length ? CORS_ORIGINS : '*',
    credentials: true,
  }),
)

interface ProxyNode {
  id: string
  address: string
  region: string
  capacity: number
  currentLoad: number
  lastSeen: number
  healthy: boolean
}

const nodes = new Map<string, ProxyNode>()

app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'dws-proxy-coordinator',
    nodes: nodes.size,
  })
})

app.get('/nodes', (c) => {
  const activeNodes = Array.from(nodes.values()).filter(
    (n) => n.healthy && Date.now() - n.lastSeen < 60000,
  )
  return c.json({ nodes: activeNodes })
})

app.post('/nodes/register', async (c) => {
  const body = await c.req.json<{
    id: string
    address: string
    region: string
    capacity: number
  }>()
  const node: ProxyNode = {
    ...body,
    currentLoad: 0,
    lastSeen: Date.now(),
    healthy: true,
  }
  nodes.set(body.id, node)
  return c.json({ success: true, node })
})

app.post('/nodes/:id/heartbeat', (c) => {
  const id = c.req.param('id')
  const node = nodes.get(id)
  if (!node) return c.json({ error: 'Node not found' }, 404)

  node.lastSeen = Date.now()
  node.healthy = true
  return c.json({ success: true })
})

app.get('/route', async (c) => {
  const region = c.req.query('region') || 'US'
  const activeNodes = Array.from(nodes.values())
    .filter((n) => n.healthy && Date.now() - n.lastSeen < 60000)
    .sort((a, b) => {
      if (a.region === region && b.region !== region) return -1
      if (b.region === region && a.region !== region) return 1
      return a.currentLoad - b.currentLoad
    })

  if (activeNodes.length === 0) {
    return c.json({ error: 'No available nodes' }, 503)
  }

  return c.json({ node: activeNodes[0] })
})

const PORT = parseInt(process.env.PROXY_COORDINATOR_PORT || '4020', 10)

if (import.meta.main) {
  console.log(`[DWS Proxy Coordinator] Running at http://localhost:${PORT}`)
  Bun.serve({ port: PORT, fetch: app.fetch })
}

export { app as coordinatorApp }

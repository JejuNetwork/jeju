/**
 * DWS Proxy Coordinator
 * Decentralized bandwidth marketplace coordinator
 */

import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'

const app = new Elysia()
app.use(cors({ origin: '*' }))

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

app.get('/health', () => {
  return {
    status: 'healthy',
    service: 'dws-proxy-coordinator',
    nodes: nodes.size,
  }
})

app.get('/nodes', () => {
  const activeNodes = Array.from(nodes.values()).filter(
    (n) => n.healthy && Date.now() - n.lastSeen < 60000,
  )
  return { nodes: activeNodes }
})

app.post('/nodes/register', ({ body }) => {
  const { id, address, region, capacity } = body as {
    id: string
    address: string
    region: string
    capacity: number
  }
  const node: ProxyNode = {
    id,
    address,
    region,
    capacity,
    currentLoad: 0,
    lastSeen: Date.now(),
    healthy: true,
  }
  nodes.set(id, node)
  return { success: true, node }
})

app.post('/nodes/:id/heartbeat', ({ params, set }) => {
  const node = nodes.get(params.id)
  if (!node) {
    set.status = 404
    return { error: 'Node not found' }
  }

  node.lastSeen = Date.now()
  node.healthy = true
  return { success: true }
})

app.get('/route', ({ query, set }) => {
  const region = (query.region as string) || 'US'
  const activeNodes = Array.from(nodes.values())
    .filter((n) => n.healthy && Date.now() - n.lastSeen < 60000)
    .sort((a, b) => {
      if (a.region === region && b.region !== region) return -1
      if (b.region === region && a.region !== region) return 1
      return a.currentLoad - b.currentLoad
    })

  if (activeNodes.length === 0) {
    set.status = 503
    return { error: 'No available nodes' }
  }

  return { node: activeNodes[0] }
})

const PORT = parseInt(process.env.PROXY_COORDINATOR_PORT || '4020', 10)

if (import.meta.main) {
  console.log(`[DWS Proxy Coordinator] Running at http://localhost:${PORT}`)
  app.listen(PORT)
}

export { app as coordinatorApp }

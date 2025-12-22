/**
 * DWS Proxy Node
 * Decentralized bandwidth provider node
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'

const app = new Hono()
app.use('/*', cors({ origin: '*' }))

const nodeId = crypto.randomUUID()
const region = process.env.NODE_REGION || 'US'
const maxConcurrent = parseInt(process.env.NODE_MAX_CONCURRENT || '10', 10)
let currentConnections = 0

let account: PrivateKeyAccount | null = null
let address: string | null = null

async function initializeWallet(): Promise<void> {
  const privateKey = process.env.NODE_PRIVATE_KEY
  if (!privateKey) {
    console.log(
      '[DWS Proxy Node] No NODE_PRIVATE_KEY set, running without wallet',
    )
    return
  }

  account = privateKeyToAccount(privateKey as `0x${string}`)
  address = account.address
  console.log(`[DWS Proxy Node] Initialized with address: ${address}`)
}

async function registerWithCoordinator(): Promise<void> {
  const coordinatorUrl = process.env.PROXY_COORDINATOR_URL?.replace(
    'ws://',
    'http://',
  ).replace(':4021', ':4020')
  if (!coordinatorUrl) {
    console.log(
      '[DWS Proxy Node] No PROXY_COORDINATOR_URL set, running standalone',
    )
    return
  }

  const response = await fetch(`${coordinatorUrl}/nodes/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: nodeId,
      address: address || nodeId,
      region,
      capacity: maxConcurrent,
    }),
  }).catch((e: Error) => {
    console.log(`[DWS Proxy Node] Failed to register: ${e.message}`)
    return null
  })

  if (response?.ok) {
    console.log('[DWS Proxy Node] Registered with coordinator')
  }
}

app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'dws-proxy-node',
    nodeId,
    region,
    address: address || 'standalone',
    currentConnections,
    maxConcurrent,
  })
})

app.get('/stats', (c) => {
  return c.json({
    nodeId,
    region,
    currentConnections,
    maxConcurrent,
    utilization: currentConnections / maxConcurrent,
  })
})

app.post('/proxy', async (c) => {
  if (currentConnections >= maxConcurrent) {
    return c.json({ error: 'Node at capacity' }, 503)
  }

  const body = await c.req.json<{
    url: string
    method?: string
    headers?: Record<string, string>
  }>()
  currentConnections++

  const response = await fetch(body.url, {
    method: body.method || 'GET',
    headers: body.headers,
  }).catch((e: Error) => {
    currentConnections--
    throw e
  })

  currentConnections--
  const data = await response.arrayBuffer()
  return new Response(data, {
    status: response.status,
    headers: {
      'Content-Type':
        response.headers.get('Content-Type') || 'application/octet-stream',
    },
  })
})

const PORT = parseInt(process.env.PROXY_NODE_PORT || '4022', 10)

if (import.meta.main) {
  initializeWallet().then(registerWithCoordinator)
  console.log(`[DWS Proxy Node] Running at http://localhost:${PORT}`)
  Bun.serve({ port: PORT, fetch: app.fetch })
}

export { app as proxyNodeApp }

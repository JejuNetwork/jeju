/**
 * DWS Proxy Node
 * Decentralized bandwidth provider node
 */

import { cors } from '@elysiajs/cors'
import { Elysia, t } from 'elysia'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'

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

// SECURITY: Configure CORS based on environment
const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',').filter(Boolean)
const isProduction = process.env.NODE_ENV === 'production'

export const proxyNodeApp = new Elysia({ name: 'proxy-node' })
  .use(cors({ 
    origin: isProduction && CORS_ORIGINS?.length ? CORS_ORIGINS : '*',
    credentials: true,
  }))
  .get('/health', () => ({
    status: 'healthy',
    service: 'dws-proxy-node',
    nodeId,
    region,
    address: address || 'standalone',
    currentConnections,
    maxConcurrent,
  }))
  .get('/stats', () => ({
    nodeId,
    region,
    currentConnections,
    maxConcurrent,
    utilization: currentConnections / maxConcurrent,
  }))
  .post(
    '/proxy',
    async ({ body, set }) => {
      if (currentConnections >= maxConcurrent) {
        set.status = 503
        return { error: 'Node at capacity' }
      }

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
    },
    {
      body: t.Object({
        url: t.String(),
        method: t.Optional(t.String()),
        headers: t.Optional(t.Record(t.String(), t.String())),
      }),
    },
  )

const PORT = parseInt(process.env.PROXY_NODE_PORT || '4022', 10)

if (import.meta.main) {
  initializeWallet().then(registerWithCoordinator)
  console.log(`[DWS Proxy Node] Running at http://localhost:${PORT}`)
  proxyNodeApp.listen(PORT)
}

export type ProxyNodeApp = typeof proxyNodeApp

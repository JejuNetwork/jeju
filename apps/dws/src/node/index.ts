/**
 * DWS Provider Node - storage and compute services
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, localhost } from 'viem/chains'

function inferChainFromRpcUrl(rpcUrl: string) {
  if (rpcUrl.includes('base-sepolia') || rpcUrl.includes('84532'))
    return baseSepolia
  if (rpcUrl.includes('base') && !rpcUrl.includes('localhost')) return base
  return localhost
}

const app = new Hono()
// SECURITY: Configure CORS based on environment
const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',').filter(Boolean)
const isProduction = process.env.NODE_ENV === 'production'
app.use('/*', cors({ 
  origin: isProduction && CORS_ORIGINS?.length ? CORS_ORIGINS : '*',
  credentials: true,
}))

const privateKey = process.env.PRIVATE_KEY
const rpcUrl = process.env.RPC_URL || 'http://localhost:6546'
const ipfsApiUrl = process.env.IPFS_API_URL || 'http://localhost:5001'

// Wallet state - initialized lazily
interface WalletState {
  account: PrivateKeyAccount
  address: Address
  publicClient: PublicClient
  walletClient: WalletClient
}

let walletState: WalletState | null = null

const pinnedCids = new Map<string, { size: number; pinnedAt: number }>()
const nodeStartTime = Date.now()

async function initializeWallet(): Promise<void> {
  if (!privateKey) {
    console.log('[DWS Node] No PRIVATE_KEY set, running in read-only mode')
    return
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`)
  const chain = inferChainFromRpcUrl(rpcUrl)

  walletState = {
    account,
    address: account.address,
    publicClient: createPublicClient({
      chain,
      transport: http(rpcUrl),
    }) as PublicClient,
    walletClient: createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    }) as WalletClient,
  }
  console.log(`[DWS Node] Initialized with address: ${walletState.address}`)
}

async function checkIpfsHealth(): Promise<boolean> {
  const response = await fetch(`${ipfsApiUrl}/api/v0/id`, { method: 'POST' })
  if (!response.ok) {
    console.warn(`[DWS Node] IPFS health check failed: ${response.status}`)
    return false
  }
  return true
}

app.get('/health', async (c) => {
  const ipfsHealthy = await checkIpfsHealth().catch((err: Error) => {
    console.warn(`[DWS Node] IPFS unreachable: ${err.message}`)
    return false
  })

  return c.json({
    status: ipfsHealthy ? 'healthy' : 'degraded',
    service: 'dws-node',
    address: walletState?.address ?? 'read-only',
    rpcUrl,
    ipfs: ipfsHealthy ? 'connected' : 'disconnected',
    uptime: Date.now() - nodeStartTime,
  })
})

app.get('/status', async (c) => {
  if (!walletState) {
    return c.json({
      address: 'read-only',
      balance: '0',
      registered: false,
      reputation: 0,
      services: ['storage', 'compute'],
      uptime: Date.now() - nodeStartTime,
      pinnedCids: pinnedCids.size,
    })
  }

  const balance = formatEther(
    await walletState.publicClient.getBalance({ address: walletState.address }),
  )
  return c.json({
    address: walletState.address,
    balance,
    registered: false,
    reputation: 0,
    services: ['storage', 'compute'],
    uptime: Date.now() - nodeStartTime,
    pinnedCids: pinnedCids.size,
  })
})

app.post('/storage/pin', async (c) => {
  if (!walletState)
    return c.json({ error: 'Read-only mode. Set PRIVATE_KEY.' }, 403)

  const body = await c.req.json<{ cid: string; size?: number }>()
  if (!body.cid) return c.json({ error: 'CID required' }, 400)

  const pinResponse = await fetch(
    `${ipfsApiUrl}/api/v0/pin/add?arg=${body.cid}`,
    { method: 'POST' },
  )
  if (!pinResponse.ok) {
    return c.json({ error: `Pin failed: ${await pinResponse.text()}` }, 500)
  }

  const pinnedAt = Date.now()
  pinnedCids.set(body.cid, { size: body.size || 0, pinnedAt })

  return c.json({
    success: true,
    cid: body.cid,
    pinnedAt,
    nodeAddress: walletState.address,
  })
})

app.get('/storage/pins', (c) => {
  return c.json({
    pins: Array.from(pinnedCids.entries()).map(([cid, info]) => ({
      cid,
      ...info,
    })),
    total: pinnedCids.size,
  })
})

app.delete('/storage/pin/:cid', async (c) => {
  if (!walletState) return c.json({ error: 'Read-only mode' }, 403)

  const cid = c.req.param('cid')
  const unpinResponse = await fetch(`${ipfsApiUrl}/api/v0/pin/rm?arg=${cid}`, {
    method: 'POST',
  })
  if (!unpinResponse.ok) {
    return c.json({ error: `Unpin failed: ${await unpinResponse.text()}` }, 500)
  }

  pinnedCids.delete(cid)
  return c.json({ success: true, cid })
})

// Compute inference - proxy to DWS server
const DWS_SERVER_URL = process.env.DWS_SERVER_URL || 'http://localhost:4030'

app.post('/compute/inference', async (c) => {
  const body = await c.req.json()
  const response = await fetch(`${DWS_SERVER_URL}/compute/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    return c.json(
      { error: `Inference failed: ${errorText}` },
      response.status as 400 | 401 | 403 | 404 | 500 | 502 | 503,
    )
  }

  const result = await response.json()
  return c.json(result)
})

const PORT = parseInt(process.env.DWS_NODE_PORT || '4031', 10)

if (import.meta.main) {
  await initializeWallet()
  console.log(`[DWS Node] Running at http://localhost:${PORT}`)
  Bun.serve({ port: PORT, fetch: app.fetch })
}

export { app as nodeApp, walletState }

/**
 * DWS Provider Node - storage and compute services
 */

import { cors } from '@elysiajs/cors'
import { Elysia, t } from 'elysia'
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

// CORS Configuration

function getCorsConfig() {
  const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',').filter(Boolean)
  const isProduction = process.env.NODE_ENV === 'production'
  return {
    origin: isProduction && CORS_ORIGINS?.length ? CORS_ORIGINS : true,
    credentials: true,
  }
}

const privateKey = process.env.PRIVATE_KEY
const rpcUrl = process.env.RPC_URL || 'http://localhost:6546'
const ipfsApiUrl = process.env.IPFS_API_URL || 'http://localhost:5001'

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

const app = new Elysia()
  .use(cors(getCorsConfig()))
  .get('/health', async () => {
    const ipfsHealthy = await checkIpfsHealth().catch((err: Error) => {
      console.warn(`[DWS Node] IPFS unreachable: ${err.message}`)
      return false
    })
    return {
      status: ipfsHealthy ? 'healthy' : 'degraded',
      service: 'dws-node',
      address: walletState?.address ?? 'read-only',
      rpcUrl,
      ipfs: ipfsHealthy ? 'connected' : 'disconnected',
      uptime: Date.now() - nodeStartTime,
    }
  })
  .get('/status', async () => {
    if (!walletState)
      return {
        address: 'read-only',
        balance: '0',
        registered: false,
        reputation: 0,
        services: ['storage', 'compute'],
        uptime: Date.now() - nodeStartTime,
        pinnedCids: pinnedCids.size,
      }
    const balance = formatEther(
      await walletState.publicClient.getBalance({
        address: walletState.address,
      }),
    )
    return {
      address: walletState.address,
      balance,
      registered: false,
      reputation: 0,
      services: ['storage', 'compute'],
      uptime: Date.now() - nodeStartTime,
      pinnedCids: pinnedCids.size,
    }
  })
  .post(
    '/storage/pin',
    async ({ body, set }) => {
      if (!walletState) {
        set.status = 403
        return { error: 'Read-only mode. Set PRIVATE_KEY.' }
      }
      const req = body as { cid: string; size?: number }
      if (!req.cid) {
        set.status = 400
        return { error: 'CID required' }
      }
      const pinResponse = await fetch(
        `${ipfsApiUrl}/api/v0/pin/add?arg=${req.cid}`,
        { method: 'POST' },
      )
      if (!pinResponse.ok) {
        set.status = 500
        return { error: `Pin failed: ${await pinResponse.text()}` }
      }
      const pinnedAt = Date.now()
      pinnedCids.set(req.cid, { size: req.size || 0, pinnedAt })
      return {
        success: true,
        cid: req.cid,
        pinnedAt,
        nodeAddress: walletState.address,
      }
    },
    { body: t.Object({ cid: t.String(), size: t.Optional(t.Number()) }) },
  )
  .get('/storage/pins', () => ({
    pins: Array.from(pinnedCids.entries()).map(([cid, info]) => ({
      cid,
      ...info,
    })),
    total: pinnedCids.size,
  }))
  .delete('/storage/pin/:cid', async ({ params, set }) => {
    if (!walletState) {
      set.status = 403
      return { error: 'Read-only mode' }
    }
    const unpinResponse = await fetch(
      `${ipfsApiUrl}/api/v0/pin/rm?arg=${params.cid}`,
      { method: 'POST' },
    )
    if (!unpinResponse.ok) {
      set.status = 500
      return { error: `Unpin failed: ${await unpinResponse.text()}` }
    }
    pinnedCids.delete(params.cid)
    return { success: true, cid: params.cid }
  })
  .post('/compute/inference', async ({ body, set }) => {
    const DWS_SERVER_URL = process.env.DWS_SERVER_URL || 'http://localhost:4030'
    const response = await fetch(`${DWS_SERVER_URL}/compute/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      set.status = response.status as 400 | 500
      return { error: `Inference failed: ${await response.text()}` }
    }
    return response.json()
  })

const PORT = parseInt(process.env.DWS_NODE_PORT || '4031', 10)

if (import.meta.main) {
  await initializeWallet()
  console.log(`[DWS Node] Running at http://localhost:${PORT}`)
  app.listen(PORT)
}

export type NodeApp = typeof app
export { app as nodeApp, walletState }

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

const privateKey = process.env.PRIVATE_KEY
const rpcUrl = process.env.RPC_URL || 'http://localhost:6546'
// IPFS API port from centralized config (default 5001)
const ipfsPort = process.env.IPFS_API_PORT ?? '5001'
const ipfsApiUrl = process.env.IPFS_API_URL || `http://localhost:${ipfsPort}`

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

// Compute inference - proxy to DWS server
const DWS_SERVER_URL = process.env.DWS_SERVER_URL || 'http://localhost:4030'

export const nodeApp = new Elysia({ name: 'dws-node' })
  .use(cors({ origin: '*' }))

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
    if (!walletState) {
      return {
        address: 'read-only',
        balance: '0',
        registered: false,
        reputation: 0,
        services: ['storage', 'compute'],
        uptime: Date.now() - nodeStartTime,
        pinnedCids: pinnedCids.size,
      }
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

      if (!body.cid) {
        set.status = 400
        return { error: 'CID required' }
      }

      const pinResponse = await fetch(
        `${ipfsApiUrl}/api/v0/pin/add?arg=${body.cid}`,
        { method: 'POST' },
      )
      if (!pinResponse.ok) {
        set.status = 500
        return { error: `Pin failed: ${await pinResponse.text()}` }
      }

      const pinnedAt = Date.now()
      pinnedCids.set(body.cid, { size: body.size || 0, pinnedAt })

      return {
        success: true,
        cid: body.cid,
        pinnedAt,
        nodeAddress: walletState.address,
      }
    },
    {
      body: t.Object({
        cid: t.String(),
        size: t.Optional(t.Number()),
      }),
    },
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
      {
        method: 'POST',
      },
    )
    if (!unpinResponse.ok) {
      set.status = 500
      return { error: `Unpin failed: ${await unpinResponse.text()}` }
    }

    pinnedCids.delete(params.cid)
    return { success: true, cid: params.cid }
  })

  .post('/compute/inference', async ({ body, set }) => {
    const response = await fetch(`${DWS_SERVER_URL}/compute/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      set.status = response.status as 400 | 401 | 403 | 404 | 500 | 502 | 503
      return { error: `Inference failed: ${errorText}` }
    }

    return response.json()
  })

// Export app type for Eden
export type NodeApp = typeof nodeApp

const PORT = parseInt(process.env.DWS_NODE_PORT || '4031', 10)

if (import.meta.main) {
  await initializeWallet()
  console.log(`[DWS Node] Running at http://localhost:${PORT}`)
  Bun.serve({ port: PORT, fetch: nodeApp.fetch })
}

export { walletState }

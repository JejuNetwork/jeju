#!/usr/bin/env bun

import {
  getCurrentNetwork,
  getKmsServiceUrl,
  getRpcUrl,
  getServiceUrl,
  isProductionEnv,
} from '@jejunetwork/config'
import {
  type Address,
  type Chain,
  createPublicClient,
  type Hex,
  http,
  isAddress,
} from 'viem'
import { z } from 'zod'

function inferChainFromRpcUrl(rpcUrl: string): Chain {
  if (
    rpcUrl.includes('localhost') ||
    rpcUrl.includes('127.0.0.1') ||
    rpcUrl.includes(':6545') ||
    rpcUrl.includes(':6546') ||
    rpcUrl.includes(':6547')
  ) {
    return {
      id: 31337,
      name: 'Local Network',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    }
  }
  if (rpcUrl.includes('testnet')) {
    return {
      id: 420691,
      name: 'Network Testnet',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    }
  }
  return {
    id: 42069,
    name: 'Network',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  }
}

const EthSyncingResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.number(),
  result: z.union([
    z.literal(false),
    z.object({
      startingBlock: z.string().optional(),
      currentBlock: z.string().optional(),
      highestBlock: z.string().optional(),
    }),
  ]),
})

type EthSyncingResult = z.infer<typeof EthSyncingResponseSchema>['result']

const NODE_ID = typeof process !== 'undefined' ? process.env.NODE_ID : undefined
const OPERATOR_ADDRESS =
  typeof process !== 'undefined'
    ? (process.env.OPERATOR_ADDRESS as Address | undefined)
    : undefined
const KMS_KEY_ID =
  typeof process !== 'undefined' ? process.env.KMS_KEY_ID : undefined
const KMS_ENDPOINT =
  (typeof process !== 'undefined' ? process.env.KMS_ENDPOINT : undefined) ??
  getKmsServiceUrl()

if (!NODE_ID) {
  throw new Error('NODE_ID environment variable is required')
}

const IS_PRODUCTION = isProductionEnv()

if (IS_PRODUCTION) {
  if (!OPERATOR_ADDRESS) {
    throw new Error('OPERATOR_ADDRESS is required in production')
  }
  if (!isAddress(OPERATOR_ADDRESS)) {
    throw new Error('OPERATOR_ADDRESS must be a valid Ethereum address')
  }
  if (!KMS_KEY_ID) {
    throw new Error('KMS_KEY_ID is required in production')
  }
  if (!KMS_ENDPOINT) {
    throw new Error('KMS_ENDPOINT is required in production')
  }
}

const network = getCurrentNetwork()
const NODE_EXPLORER_API =
  process.env.NODE_EXPLORER_API ??
  getServiceUrl('gateway', 'api', network) ??
  'https://nodes.jejunetwork.org/api'
const RPC_URL =
  (typeof process !== 'undefined' ? process.env.RPC_URL : undefined) ??
  getRpcUrl(network)
const HEARTBEAT_INTERVAL = process.env.HEARTBEAT_INTERVAL
const INTERVAL = HEARTBEAT_INTERVAL ? parseInt(HEARTBEAT_INTERVAL, 10) : 300000

if (Number.isNaN(INTERVAL) || INTERVAL <= 0) {
  throw new Error('HEARTBEAT_INTERVAL must be a positive number')
}

const CONFIG = {
  NODE_ID,
  OPERATOR_ADDRESS,
  KMS_KEY_ID,
  KMS_ENDPOINT,
  NODE_EXPLORER_API,
  RPC_URL,
  INTERVAL,
  IS_PRODUCTION,
}

const KMSSignResponseSchema = z.object({
  signature: z.string(),
  keyId: z.string().optional(),
  address: z.string().optional(),
  signedAt: z.number().optional(),
  mode: z.string().optional(),
})

async function signWithKMS(message: string): Promise<Hex> {
  if (!CONFIG.KMS_ENDPOINT || !CONFIG.KMS_KEY_ID || !CONFIG.OPERATOR_ADDRESS) {
    throw new Error('KMS configuration incomplete')
  }

  const response = await fetch(`${CONFIG.KMS_ENDPOINT}/sign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': CONFIG.OPERATOR_ADDRESS,
    },
    body: JSON.stringify({
      keyId: CONFIG.KMS_KEY_ID,
      messageHash: message,
      encoding: 'text',
    }),
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    const error = await response.text().catch(() => 'Unknown error')
    throw new Error(`KMS signing failed: ${response.status} - ${error}`)
  }

  const result = KMSSignResponseSchema.parse(await response.json())
  return result.signature as Hex
}

const HeartbeatResponseSchema = z.object({
  uptime_score: z.number(),
})

async function signWithLocalKey(message: string): Promise<Hex> {
  const { privateKeyToAccount } = await import('viem/accounts')
  const { isHex } = await import('viem')

  const key = process.env.OPERATOR_PRIVATE_KEY
  if (!key) {
    throw new Error('OPERATOR_PRIVATE_KEY required for development mode')
  }
  if (!isHex(key) || key.length !== 66) {
    throw new Error('OPERATOR_PRIVATE_KEY must be a 64-char hex with 0x prefix')
  }

  const account = privateKeyToAccount(key as `0x${string}`)
  return await account.signMessage({ message })
}

async function signMessage(message: string): Promise<Hex> {
  if (CONFIG.IS_PRODUCTION) {
    return signWithKMS(message)
  }

  if (CONFIG.KMS_ENDPOINT && CONFIG.KMS_KEY_ID && CONFIG.OPERATOR_ADDRESS) {
    return signWithKMS(message)
  }

  return signWithLocalKey(message)
}

async function sendHeartbeat(): Promise<void> {
  const chain = inferChainFromRpcUrl(CONFIG.RPC_URL)
  const publicClient = createPublicClient({
    chain,
    transport: http(CONFIG.RPC_URL),
  })

  const chainId = await publicClient.getChainId()
  const blockNumber = await publicClient.getBlockNumber()

  const peerCountResponse = await publicClient.request({
    method: 'net_peerCount',
  })
  const peerCount =
    typeof peerCountResponse === 'string' ? peerCountResponse : '0x0'

  const syncingResult = await fetch(CONFIG.RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_syncing',
      params: [],
      id: 1,
    }),
  })
  const syncingParsed = EthSyncingResponseSchema.safeParse(
    await syncingResult.json(),
  )

  let isSyncing: EthSyncingResult = false
  if (syncingParsed.success) {
    isSyncing = syncingParsed.data.result
  }

  const startTime = Date.now()
  await publicClient.getBlockNumber()
  const responseTime = Date.now() - startTime
  const timestamp = Date.now()
  const message = `Heartbeat:v1:${chainId}:${CONFIG.NODE_ID}:${timestamp}:${blockNumber}`

  const signature = await signMessage(message)

  const response = await fetch(`${CONFIG.NODE_EXPLORER_API}/nodes/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      node_id: CONFIG.NODE_ID,
      chain_id: chainId,
      block_number: blockNumber,
      peer_count: parseInt(peerCount, 16),
      is_syncing: isSyncing !== false,
      response_time: responseTime,
      timestamp,
      signature,
      message,
    }),
  })

  if (!response.ok) {
    throw new Error(
      `Heartbeat failed: ${response.status} ${response.statusText}`,
    )
  }

  const parsed = HeartbeatResponseSchema.safeParse(await response.json())
  if (!parsed.success) {
    throw new Error(`Invalid heartbeat response: ${parsed.error.message}`)
  }

  console.log(
    `Heartbeat sent (uptime: ${(parsed.data.uptime_score * 100).toFixed(2)}%)`,
  )
}

async function main(): Promise<void> {
  console.log('Heartbeat service starting...')
  console.log(`Node ID: ${CONFIG.NODE_ID}`)
  console.log(`Interval: ${CONFIG.INTERVAL / 1000}s`)
  console.log(`Mode: ${CONFIG.IS_PRODUCTION ? 'KMS' : 'Development'}`)

  await sendHeartbeat()

  setInterval(async () => {
    try {
      await sendHeartbeat()
    } catch (error) {
      console.error(
        'Heartbeat error:',
        error instanceof Error ? error.message : String(error),
      )
    }
  }, CONFIG.INTERVAL)

  console.log('Heartbeat service running')
}

if (import.meta.main) {
  main().catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}

export { sendHeartbeat }

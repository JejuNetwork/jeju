#!/usr/bin/env bun
/** Heartbeat service - sends regular heartbeats to node explorer. */

import { getRpcUrl } from '@jejunetwork/config'
import { type Chain, createPublicClient, http, isHex } from 'viem'

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

import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

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

const NODE_ID = process.env.NODE_ID
const OPERATOR_PRIVATE_KEY = process.env.OPERATOR_PRIVATE_KEY

if (!NODE_ID) {
  throw new Error('NODE_ID environment variable is required')
}
if (!OPERATOR_PRIVATE_KEY) {
  throw new Error('OPERATOR_PRIVATE_KEY environment variable is required')
}
const VALIDATED_PRIVATE_KEY: string = OPERATOR_PRIVATE_KEY

/** Validate and parse a hex private key. */
function parsePrivateKey(key: string): `0x${string}` {
  if (!isHex(key) || key.length !== 66) {
    throw new Error(
      'OPERATOR_PRIVATE_KEY must be a 64-character hex string with 0x prefix',
    )
  }
  return key
}

/** Creates the operator account from environment. Encapsulated to prevent key leakage. */
function getOperatorAccount() {
  const key = parsePrivateKey(VALIDATED_PRIVATE_KEY)
  return privateKeyToAccount(key)
}

const NODE_EXPLORER_API =
  process.env.NODE_EXPLORER_API ?? 'https://nodes.jejunetwork.org/api'
const RPC_URL = process.env.RPC_URL ?? getRpcUrl()
const HEARTBEAT_INTERVAL = process.env.HEARTBEAT_INTERVAL
const INTERVAL = HEARTBEAT_INTERVAL ? parseInt(HEARTBEAT_INTERVAL, 10) : 300000

if (Number.isNaN(INTERVAL) || INTERVAL <= 0) {
  throw new Error('HEARTBEAT_INTERVAL must be a positive number')
}

const CONFIG = {
  NODE_ID,
  NODE_EXPLORER_API,
  RPC_URL,
  INTERVAL,
}

const HeartbeatResponseSchema = z.object({
  uptime_score: z.number(),
})

async function sendHeartbeat(): Promise<void> {
  const chain = inferChainFromRpcUrl(CONFIG.RPC_URL)
  const publicClient = createPublicClient({
    chain,
    transport: http(CONFIG.RPC_URL),
  })
  const account = getOperatorAccount()

  const chainId = await publicClient.getChainId()
  const blockNumber = await publicClient.getBlockNumber()

  // net_peerCount returns a hex string
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
  } else {
    console.warn(
      `Warning: Invalid eth_syncing response, assuming not syncing: ${syncingParsed.error.message}`,
    )
  }

  const startTime = Date.now()
  await publicClient.getBlockNumber()
  const responseTime = Date.now() - startTime
  const timestamp = Date.now()
  const message = `Heartbeat:v1:${chainId}:${CONFIG.NODE_ID}:${timestamp}:${blockNumber}`
  const signature = await account.signMessage({ message })
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
    `💓 Heartbeat sent (uptime: ${(parsed.data.uptime_score * 100).toFixed(2)}%)`,
  )
}

async function main(): Promise<void> {
  console.log('💓 Heartbeat service starting...')
  console.log(`   Node ID: ${CONFIG.NODE_ID}`)
  console.log(`   Interval: ${CONFIG.INTERVAL / 1000}s`)

  await sendHeartbeat()

  setInterval(async () => {
    try {
      await sendHeartbeat()
    } catch (error) {
      console.error(
        '❌ Heartbeat error:',
        error instanceof Error ? error.message : String(error),
      )
    }
  }, CONFIG.INTERVAL)

  console.log('✅ Heartbeat service running\n')
}

if (import.meta.main) {
  main().catch((error) => {
    console.error('💥 Fatal error:', error)
    process.exit(1)
  })
}

export { sendHeartbeat }

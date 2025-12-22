#!/usr/bin/env bun

/**
 * @title Heartbeat Service
 * @notice Sends regular heartbeats to node explorer
 */

import { inferChainFromRpcUrl } from '@jejunetwork/deployment/scripts/shared/chain-utils'
import { createPublicClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

// Schema for eth_syncing JSON-RPC response
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

// Validate and parse environment config
const NODE_ID = process.env.NODE_ID
const OPERATOR_PRIVATE_KEY = process.env.OPERATOR_PRIVATE_KEY

if (!NODE_ID) {
  throw new Error('NODE_ID environment variable is required')
}
if (!OPERATOR_PRIVATE_KEY) {
  throw new Error('OPERATOR_PRIVATE_KEY environment variable is required')
}

// Optional config with explicit defaults
const NODE_EXPLORER_API =
  process.env.NODE_EXPLORER_API ?? 'https://nodes.jejunetwork.org/api'
const RPC_URL = process.env.RPC_URL ?? 'http://localhost:9545'
const HEARTBEAT_INTERVAL = process.env.HEARTBEAT_INTERVAL
const INTERVAL = HEARTBEAT_INTERVAL ? parseInt(HEARTBEAT_INTERVAL, 10) : 300000

if (Number.isNaN(INTERVAL) || INTERVAL <= 0) {
  throw new Error('HEARTBEAT_INTERVAL must be a positive number')
}

const CONFIG = {
  NODE_ID,
  OPERATOR_PRIVATE_KEY,
  NODE_EXPLORER_API,
  RPC_URL,
  INTERVAL,
}

// Zod schema for heartbeat API response
const HeartbeatResponseSchema = z.object({
  uptime_score: z.number(),
})

async function sendHeartbeat(): Promise<void> {
  const chain = inferChainFromRpcUrl(CONFIG.RPC_URL)
  const publicClient = createPublicClient({
    chain,
    transport: http(CONFIG.RPC_URL),
  })
  const account = privateKeyToAccount(
    CONFIG.OPERATOR_PRIVATE_KEY as `0x${string}`,
  )

  // Get chain ID for replay protection
  const chainId = await publicClient.getChainId()

  // Get node stats
  const blockNumber = await publicClient.getBlockNumber()
  const peerCount = (await publicClient.request({
    method: 'net_peerCount',
  })) as string

  // eth_syncing is valid JSON-RPC but viem types are incomplete - validate with schema
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
  await publicClient.getBlockNumber() // Test response time
  const responseTime = Date.now() - startTime
  const timestamp = Date.now()

  // Sign heartbeat with chain ID included for replay protection across chains
  // Format: "Heartbeat:v1:{chainId}:{nodeId}:{timestamp}:{blockNumber}"
  const message = `Heartbeat:v1:${chainId}:${CONFIG.NODE_ID}:${timestamp}:${blockNumber}`
  const signature = await account.signMessage({ message })

  // Send to explorer
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
      message, // Include message for signature verification
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

  // Initial heartbeat - fail fast if configuration is wrong
  await sendHeartbeat()

  // Regular heartbeats - log errors but keep running
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

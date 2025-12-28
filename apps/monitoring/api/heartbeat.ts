#!/usr/bin/env bun
/**
 * Heartbeat service - sends regular heartbeats to node explorer.
 *
 * SECURITY: This service uses KMS for signing to prevent private key exposure.
 * In a TEE side-channel attack scenario, the private key never exists in memory
 * because signing is delegated to the KMS service.
 *
 * Two modes are supported:
 * 1. KMS Mode (production): Uses @jejunetwork/kms ThresholdSigner for MPC signing
 * 2. Legacy Mode (development only): Direct key signing (insecure, for local dev)
 */

import {
  getKmsServiceUrl,
  getRpcUrl,
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

// ============================================================================
// Configuration
// ============================================================================

const NODE_ID = process.env.NODE_ID
const OPERATOR_ADDRESS = process.env.OPERATOR_ADDRESS as Address | undefined
const KMS_KEY_ID = process.env.KMS_KEY_ID
const KMS_ENDPOINT = process.env.KMS_ENDPOINT ?? getKmsServiceUrl()

if (!NODE_ID) {
  throw new Error('NODE_ID environment variable is required')
}

// Production MUST use KMS - no raw private keys allowed
const IS_PRODUCTION = isProductionEnv()

if (IS_PRODUCTION) {
  if (!OPERATOR_ADDRESS) {
    throw new Error(
      'OPERATOR_ADDRESS environment variable is required in production',
    )
  }
  if (!isAddress(OPERATOR_ADDRESS)) {
    throw new Error('OPERATOR_ADDRESS must be a valid Ethereum address')
  }
  if (!KMS_KEY_ID) {
    throw new Error('KMS_KEY_ID environment variable is required in production')
  }
  if (!KMS_ENDPOINT) {
    throw new Error(
      'KMS_ENDPOINT environment variable is required in production',
    )
  }
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
  OPERATOR_ADDRESS,
  KMS_KEY_ID,
  KMS_ENDPOINT,
  NODE_EXPLORER_API,
  RPC_URL,
  INTERVAL,
  IS_PRODUCTION,
}

// ============================================================================
// KMS Signing Client
// ============================================================================

const KMSSignResponseSchema = z.object({
  signature: z.string(),
  keyId: z.string().optional(),
  address: z.string().optional(),
  signedAt: z.number().optional(),
  mode: z.string().optional(),
})

/**
 * Sign a message using the KMS service.
 * The private key never leaves the KMS - only the signature is returned.
 */
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

// ============================================================================
// Development Mode (INSECURE - only for local testing)
// ============================================================================

/**
 * Development-only signing using local private key.
 * WARNING: This is INSECURE and should NEVER be used in production.
 * The private key exists in memory and is vulnerable to side-channel attacks.
 */
async function signWithLocalKey(message: string): Promise<Hex> {
  // Dynamic import to avoid loading in production
  const { privateKeyToAccount } = await import('viem/accounts')
  const { isHex } = await import('viem')

  const key = process.env.OPERATOR_PRIVATE_KEY
  if (!key) {
    throw new Error('OPERATOR_PRIVATE_KEY required for development mode')
  }
  if (!isHex(key) || key.length !== 66) {
    throw new Error(
      'OPERATOR_PRIVATE_KEY must be a 64-char hex string with 0x prefix',
    )
  }

  console.warn(
    '⚠️  SECURITY WARNING: Using insecure local signing (development only)',
  )
  console.warn(
    '⚠️  Private key is exposed in memory - vulnerable to side-channel attacks',
  )

  const account = privateKeyToAccount(key as `0x${string}`)
  const signature = await account.signMessage({ message })
  return signature
}

/**
 * Sign a message using the appropriate method based on environment.
 * Production: Uses KMS (private key never in memory)
 * Development: Uses local key (insecure, for testing only)
 */
async function signMessage(message: string): Promise<Hex> {
  if (CONFIG.IS_PRODUCTION) {
    return signWithKMS(message)
  }

  // Development mode - allow local signing with clear warning
  if (CONFIG.KMS_ENDPOINT && CONFIG.KMS_KEY_ID && CONFIG.OPERATOR_ADDRESS) {
    // If KMS is configured, use it even in development
    console.log('🔐 Using KMS signing (recommended)')
    return signWithKMS(message)
  }

  // Fallback to local key for development only
  return signWithLocalKey(message)
}

// ============================================================================
// Heartbeat Logic
// ============================================================================

async function sendHeartbeat(): Promise<void> {
  const chain = inferChainFromRpcUrl(CONFIG.RPC_URL)
  const publicClient = createPublicClient({
    chain,
    transport: http(CONFIG.RPC_URL),
  })

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

  // SECURITY: Sign using KMS in production, local key only in development
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
    `💓 Heartbeat sent (uptime: ${(parsed.data.uptime_score * 100).toFixed(2)}%)`,
  )
}

async function main(): Promise<void> {
  console.log('💓 Heartbeat service starting...')
  console.log(`   Node ID: ${CONFIG.NODE_ID}`)
  console.log(`   Interval: ${CONFIG.INTERVAL / 1000}s`)

  // Show security mode
  if (CONFIG.IS_PRODUCTION) {
    console.log('   Mode: 🔐 KMS (secure)')
    console.log(`   KMS Endpoint: ${CONFIG.KMS_ENDPOINT}`)
    console.log(`   Operator Address: ${CONFIG.OPERATOR_ADDRESS}`)
  } else if (CONFIG.KMS_ENDPOINT && CONFIG.KMS_KEY_ID) {
    console.log('   Mode: 🔐 KMS (development)')
  } else {
    console.log('   Mode: ⚠️  Local signing (INSECURE - development only)')
  }

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

/**
 * Protocol Middleware - ERC-8004 Identity & x402 Payment Verification
 *
 * Provides standardized middleware for:
 * - ERC-8004 agent identity verification
 * - Ban status checking via BanManager
 * - x402 payment verification and settlement
 * - Rate limiting with stake tiers
 */

import { timingSafeEqual } from 'node:crypto'
import { Elysia } from 'elysia'
import type { Address } from 'viem'
import { createPublicClient, getAddress, http, verifyMessage } from 'viem'
import { z } from 'zod'
import { NETWORK_BAN_MANAGER_ABI } from '../api/abis'
import { getChain } from '../chains'

/**
 * Constant-time string comparison to prevent timing attacks.
 * Both strings are normalized to lowercase before comparison.
 */
function constantTimeAddressCompare(a: string, b: string): boolean {
  const normalizedA = a.toLowerCase()
  const normalizedB = b.toLowerCase()

  // Ensure same length (addresses should be same length)
  if (normalizedA.length !== normalizedB.length) {
    return false
  }

  const bufA = Buffer.from(normalizedA, 'utf8')
  const bufB = Buffer.from(normalizedB, 'utf8')

  return timingSafeEqual(bufA, bufB)
}

const X402PaymentPayloadSchema = z.object({
  scheme: z.string(),
  network: z.string(),
  amount: z.string(),
  asset: z.string(),
  payTo: z.string(),
  resource: z.string(),
  nonce: z.string(),
  timestamp: z.number(),
  signature: z.string(),
})

// ============================================================================
// Types
// ============================================================================

export interface ERC8004Config {
  rpcUrl: string
  identityRegistryAddress: Address
  banManagerAddress?: Address
  requireRegistration?: boolean
  requireActive?: boolean
}

export interface X402Config {
  network: string
  facilitatorAddress?: Address
  paymentRecipient: Address
  maxPaymentAge?: number
  supportedAssets?: Address[]
}

export interface PaymentRequirement {
  x402Version: number
  scheme: 'exact' | 'upto'
  network: string
  maxAmountRequired: string
  asset: Address
  payTo: Address
  resource: string
  description: string
}

export interface SkillResult {
  message: string
  data: Record<string, unknown>
  requiresPayment?: PaymentRequirement
}

export interface AgentInfo {
  agentId: bigint
  owner: Address
  name: string
  active: boolean
  a2aEndpoint: string
  mcpEndpoint: string
  tags: string[]
  banned: boolean
  banReason?: string
}

// Context types for Elysia derive
export interface ProtocolContext {
  userAddress: Address | null
  agentInfo: AgentInfo | null
  paymentVerified: boolean
  paymentSigner: Address | null
}

// ============================================================================
// ABI Fragments
// ============================================================================

const IDENTITY_REGISTRY_ABI = [
  {
    name: 'getAgentByAddress',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'agentId', type: 'uint256' },
          { name: 'owner', type: 'address' },
          { name: 'name', type: 'string' },
          { name: 'active', type: 'bool' },
          { name: 'a2aEndpoint', type: 'string' },
          { name: 'mcpEndpoint', type: 'string' },
        ],
      },
    ],
  },
  {
    name: 'getAgentTags',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: 'tags', type: 'bytes32[]' }],
  },
] as const

// ============================================================================
// ERC-8004 Identity Verification
// ============================================================================

let erc8004Client: ReturnType<typeof createPublicClient> | null = null
let erc8004Config: ERC8004Config | null = null

export function configureERC8004(config: ERC8004Config): void {
  erc8004Config = config
  erc8004Client = createPublicClient({
    chain: getChain(
      config.rpcUrl.includes('localhost') ? 'localnet' : 'testnet',
    ),
    transport: http(config.rpcUrl),
  })
}

export async function getAgentInfo(
  address: Address,
): Promise<AgentInfo | null> {
  if (!erc8004Client || !erc8004Config) {
    throw new Error(
      'ERC-8004 middleware not configured. Call configureERC8004() first.',
    )
  }

  const agent = await erc8004Client.readContract({
    address: erc8004Config.identityRegistryAddress,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getAgentByAddress',
    args: [address],
  })

  if (!agent || agent.agentId === 0n) {
    return null
  }

  // Get tags
  const tagsRaw = await erc8004Client.readContract({
    address: erc8004Config.identityRegistryAddress,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getAgentTags',
    args: [agent.agentId],
  })
  const tags = tagsRaw.map((t: `0x${string}`) => {
    const str = Buffer.from(t.slice(2), 'hex').toString('utf8')
    return str.replace(/\0/g, '')
  })

  // Check ban status if BanManager is configured
  let banned = false
  let banReason: string | undefined

  if (erc8004Config.banManagerAddress) {
    const banInfo = await erc8004Client.readContract({
      address: erc8004Config.banManagerAddress,
      abi: NETWORK_BAN_MANAGER_ABI,
      functionName: 'getNetworkBan',
      args: [agent.agentId],
    })
    banned = banInfo.isBanned
    banReason = banInfo.reason
  }

  return {
    agentId: agent.agentId,
    owner: agent.owner,
    name: agent.name,
    active: agent.active,
    a2aEndpoint: agent.a2aEndpoint,
    mcpEndpoint: agent.mcpEndpoint,
    tags,
    banned,
    banReason,
  }
}

/**
 * ERC-8004 context type for route handlers
 */
export interface ERC8004Context {
  userAddress: Address | null
  agentInfo: AgentInfo | null
  erc8004Error: { error: string; reason?: string } | null
}

/**
 * Helper to verify ERC-8004 identity from headers
 */
export async function verifyERC8004Identity(
  headers: Record<string, string | undefined>,
  options: { requireRegistration?: boolean; requireActive?: boolean } = {},
): Promise<ERC8004Context> {
  const address = headers['x-jeju-address'] as Address | undefined

  if (!address) {
    if (options.requireRegistration) {
      return {
        userAddress: null,
        agentInfo: null,
        erc8004Error: { error: 'x-jeju-address header required' },
      }
    }
    return {
      userAddress: null,
      agentInfo: null,
      erc8004Error: null,
    }
  }

  const agentInfo = await getAgentInfo(address)

  if (options.requireRegistration && !agentInfo) {
    return {
      userAddress: address,
      agentInfo: null,
      erc8004Error: { error: 'Address not registered as ERC-8004 agent' },
    }
  }

  if (agentInfo?.banned) {
    return {
      userAddress: address,
      agentInfo,
      erc8004Error: {
        error: 'Agent is banned from the network',
        reason: agentInfo.banReason,
      },
    }
  }

  if (options.requireActive && agentInfo && !agentInfo.active) {
    return {
      userAddress: address,
      agentInfo,
      erc8004Error: { error: 'Agent registration is not active' },
    }
  }

  return {
    userAddress: address,
    agentInfo,
    erc8004Error: null,
  }
}

/**
 * Creates an Elysia plugin for ERC-8004 identity verification
 */
export function erc8004Middleware(
  options: { requireRegistration?: boolean; requireActive?: boolean } = {},
) {
  return new Elysia({ name: 'erc8004' }).derive(async ({ headers, set }) => {
    const context = await verifyERC8004Identity(headers, options)

    if (context.erc8004Error) {
      set.status = context.userAddress ? 403 : 401
    }

    return { ...context }
  })
}

// ============================================================================
// x402 Payment Verification
// ============================================================================

let x402Config: X402Config | null = null

// Bounded nonce cache to prevent DoS via memory exhaustion
// Uses Map to track timestamps for expiration-based eviction
const MAX_NONCE_CACHE_SIZE = 100000
const NONCE_TTL_MS = 600000 // 10 minutes - nonces older than this are evicted
const usedNonces = new Map<string, number>() // nonce -> timestamp

function cleanupExpiredNonces(): void {
  const now = Date.now()
  const expiredThreshold = now - NONCE_TTL_MS

  for (const [nonce, timestamp] of usedNonces) {
    if (timestamp < expiredThreshold) {
      usedNonces.delete(nonce)
    }
  }
}

function addNonce(nonce: string): boolean {
  // Check if already used
  if (usedNonces.has(nonce)) {
    return false
  }

  // Cleanup if approaching max size
  if (usedNonces.size >= MAX_NONCE_CACHE_SIZE) {
    cleanupExpiredNonces()

    // If still too large after cleanup, evict oldest entries
    if (usedNonces.size >= MAX_NONCE_CACHE_SIZE) {
      const entries = Array.from(usedNonces.entries()).sort(
        (a, b) => a[1] - b[1],
      )

      // Remove oldest 10% of entries
      const toRemove = Math.ceil(entries.length * 0.1)
      for (let i = 0; i < toRemove; i++) {
        usedNonces.delete(entries[i][0])
      }
    }
  }

  usedNonces.set(nonce, Date.now())
  return true
}

export function configureX402(config: X402Config): void {
  x402Config = config
}

export function createPaymentRequirement(
  resource: string,
  amount: string,
  description: string,
  asset: Address = '0x0000000000000000000000000000000000000000' as Address,
): PaymentRequirement {
  if (!x402Config) {
    throw new Error(
      'x402 middleware not configured. Call configureX402() first.',
    )
  }

  return {
    x402Version: 1,
    scheme: 'exact',
    network: x402Config.network,
    maxAmountRequired: amount,
    asset,
    payTo: x402Config.paymentRecipient,
    resource,
    description,
  }
}

export interface X402PaymentPayload {
  scheme: string
  network: string
  amount: string
  asset: Address
  payTo: Address
  resource: string
  nonce: string
  timestamp: number
  signature: `0x${string}`
}

export function parseX402Header(header: string): X402PaymentPayload | null {
  if (!header.startsWith('x402:')) return null

  const parts = header.split(':')
  if (parts.length < 3) return null

  const payloadB64 = parts[2]
  const payloadJson = Buffer.from(payloadB64, 'base64').toString('utf8')

  const parseResult = X402PaymentPayloadSchema.safeParse(
    JSON.parse(payloadJson),
  )
  if (!parseResult.success) return null

  return {
    ...parseResult.data,
    asset: parseResult.data.asset as Address,
    payTo: parseResult.data.payTo as Address,
    signature: parseResult.data.signature as `0x${string}`,
  }
}

export async function verifyX402Payment(
  paymentHeader: string,
  expectedAmount: bigint,
  expectedResource: string,
): Promise<{ valid: boolean; signer?: Address; error?: string }> {
  if (!x402Config) {
    throw new Error(
      'x402 middleware not configured. Call configureX402() first.',
    )
  }

  const payload = parseX402Header(paymentHeader)
  if (!payload) return { valid: false, error: 'Invalid payment header format' }

  // Validate timestamp
  const maxAge = x402Config.maxPaymentAge ?? 300
  if (Math.abs(Date.now() / 1000 - payload.timestamp) > maxAge) {
    return { valid: false, error: 'Payment expired' }
  }

  // Validate amount
  if (BigInt(payload.amount) < expectedAmount) {
    return { valid: false, error: 'Insufficient payment amount' }
  }

  // Validate resource
  if (payload.resource !== expectedResource) {
    return { valid: false, error: 'Resource mismatch' }
  }

  // Validate recipient using constant-time comparison to prevent timing attacks
  if (!constantTimeAddressCompare(payload.payTo, x402Config.paymentRecipient)) {
    return { valid: false, error: 'Wrong payment recipient' }
  }

  // Validate nonce hasn't been used (uses bounded cache with auto-eviction)
  const nonceKey = `${payload.nonce}`
  if (usedNonces.has(nonceKey)) {
    return { valid: false, error: 'Nonce already used' }
  }

  // Verify signature
  const message = `x402:${payload.scheme}:${payload.network}:${payload.payTo}:${payload.amount}:${payload.asset}:${payload.resource}:${payload.nonce}:${payload.timestamp}`

  let signer: Address
  try {
    const valid = await verifyMessage({
      address: getAddress(payload.payTo),
      message,
      signature: payload.signature,
    })
    if (!valid) {
      return { valid: false, error: 'Invalid signature' }
    }
    signer = payload.payTo
  } catch {
    return { valid: false, error: 'Signature verification failed' }
  }

  // Mark nonce as used (bounded cache prevents DoS)
  if (!addNonce(nonceKey)) {
    return { valid: false, error: 'Nonce already used' }
  }

  return { valid: true, signer }
}

/**
 * X402 context type for route handlers
 */
export interface X402Context {
  paymentVerified: boolean
  paymentSigner: Address | null
  x402Error: {
    error: string
    x402?: PaymentRequirement
    details?: string
  } | null
}

/**
 * Helper to verify x402 payment from headers
 */
export async function verifyX402FromHeaders(
  headers: Record<string, string | undefined>,
  path: string,
  requiredAmount?: bigint,
): Promise<X402Context> {
  const paymentHeader = headers['x-payment']

  if (!paymentHeader) {
    if (requiredAmount && requiredAmount > 0n) {
      const requirement = createPaymentRequirement(
        path,
        requiredAmount.toString(),
        'Payment required for this endpoint',
      )
      return {
        paymentVerified: false,
        paymentSigner: null,
        x402Error: {
          error: 'Payment Required',
          x402: requirement,
        },
      }
    }
    return {
      paymentVerified: false,
      paymentSigner: null,
      x402Error: null,
    }
  }

  const result = await verifyX402Payment(
    paymentHeader,
    requiredAmount ?? 0n,
    path,
  )

  if (!result.valid) {
    return {
      paymentVerified: false,
      paymentSigner: null,
      x402Error: {
        error: 'Payment verification failed',
        details: result.error,
      },
    }
  }

  return {
    paymentVerified: true,
    paymentSigner: result.signer ?? null,
    x402Error: null,
  }
}

/**
 * Creates an Elysia plugin for x402 payment verification
 */
export function x402Middleware(requiredAmount?: bigint) {
  return new Elysia({ name: 'x402' }).derive(async ({ headers, path, set }) => {
    const context = await verifyX402FromHeaders(headers, path, requiredAmount)

    if (context.x402Error) {
      set.status = 402
    }

    return { ...context }
  })
}

// ============================================================================
// Combined Middleware Helper
// ============================================================================

export interface ProtocolMiddlewareConfig {
  erc8004?: ERC8004Config & {
    requireRegistration?: boolean
    requireActive?: boolean
  }
  x402?: X402Config
}

export function configureProtocolMiddleware(
  config: ProtocolMiddlewareConfig,
): void {
  if (config.erc8004) {
    configureERC8004(config.erc8004)
  }
  if (config.x402) {
    configureX402(config.x402)
  }
}

// ============================================================================
// Skill Result Helpers
// ============================================================================

export function skillSuccess(
  message: string,
  data: Record<string, unknown>,
): SkillResult {
  return { message, data }
}

export function skillError(
  error: string,
  details?: Record<string, unknown>,
): SkillResult {
  return { message: error, data: { error, ...details } }
}

export function skillRequiresPayment(
  resource: string,
  amount: string,
  description: string,
  asset?: Address,
): SkillResult {
  return {
    message: 'Payment required',
    data: {},
    requiresPayment: createPaymentRequirement(
      resource,
      amount,
      description,
      asset,
    ),
  }
}

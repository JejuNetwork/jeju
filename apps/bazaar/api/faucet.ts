/**
 * Faucet Service for Bazaar
 * Provides JEJU tokens for local development and testing
 */

import {
  AddressSchema,
  expectAddress,
  isHexString,
  ZERO_ADDRESS,
} from '@jejunetwork/types'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatEther,
  http,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'
import {
  CHAIN_ID,
  CONTRACTS,
  EXPLORER_URL,
  NETWORK_NAME,
  RPC_URL,
} from '../config'

const FAUCET_CONFIG = {
  cooldownMs: 12 * 60 * 60 * 1000, // 12 hours
  amountPerClaim: parseEther('100'),
  jejuTokenAddress: CONTRACTS.jeju,
  identityRegistryAddress: CONTRACTS.identityRegistry,
  faucetPrivateKey: process.env.FAUCET_PRIVATE_KEY,
} as const

// Chain definition for local/testnet
const chain = {
  id: CHAIN_ID,
  name: NETWORK_NAME,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
}

export const FaucetStatusSchema = z.object({
  eligible: z.boolean(),
  isRegistered: z.boolean(),
  cooldownRemaining: z.number().nonnegative(),
  nextClaimAt: z.number().nullable(),
  amountPerClaim: z.string(),
  faucetBalance: z.string(),
})

export const FaucetClaimResultSchema = z.object({
  success: z.boolean(),
  txHash: z.string().optional(),
  amount: z.string().optional(),
  error: z.string().optional(),
  cooldownRemaining: z.number().optional(),
})

export const FaucetInfoSchema = z.object({
  name: z.string(),
  description: z.string(),
  tokenSymbol: z.string(),
  amountPerClaim: z.string(),
  cooldownHours: z.number(),
  requirements: z.array(z.string()),
  chainId: z.number(),
  chainName: z.string(),
  explorerUrl: z.string(),
  isConfigured: z.boolean(),
})

export const ClaimRequestSchema = z.object({
  address: AddressSchema,
})

export type FaucetStatus = z.infer<typeof FaucetStatusSchema>
export type FaucetClaimResult = z.infer<typeof FaucetClaimResultSchema>
export type FaucetInfo = z.infer<typeof FaucetInfoSchema>

type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: z.ZodError }

/**
 * Parse JSON response with Zod schema validation.
 * Encapsulates unknown handling for external API responses.
 */
export async function parseJsonResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<ParseResult<T>> {
  const result = schema.safeParse(await response.json())
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error }
}

interface FaucetClaim {
  lastClaim: number
  totalClaims: number
}

// Maximum entries to prevent unbounded growth
const MAX_CLAIM_ENTRIES = 100000

const claimState = new Map<string, FaucetClaim>()
// Track in-flight claims to prevent race conditions
const inFlightClaims = new Set<string>()

export const faucetState = {
  getLastClaim(address: string): number | null {
    const claim = claimState.get(address.toLowerCase())
    return claim?.lastClaim ?? null
  },

  isClaimInProgress(address: string): boolean {
    return inFlightClaims.has(address.toLowerCase())
  },

  startClaim(address: string): boolean {
    const addr = address.toLowerCase()
    if (inFlightClaims.has(addr)) {
      return false // Claim already in progress
    }
    inFlightClaims.add(addr)
    return true
  },

  finishClaim(address: string, success: boolean): void {
    const addr = address.toLowerCase()
    inFlightClaims.delete(addr)

    if (success) {
      // Evict oldest entry if at capacity
      if (claimState.size >= MAX_CLAIM_ENTRIES) {
        const firstKey = claimState.keys().next().value
        if (firstKey) claimState.delete(firstKey)
      }

      const existing = claimState.get(addr)
      claimState.set(addr, {
        lastClaim: Date.now(),
        totalClaims: (existing?.totalClaims ?? 0) + 1,
      })
    }
  },

  recordClaim(address: string): void {
    const addr = address.toLowerCase()
    // Evict oldest entry if at capacity
    if (claimState.size >= MAX_CLAIM_ENTRIES) {
      const firstKey = claimState.keys().next().value
      if (firstKey) claimState.delete(firstKey)
    }
    const existing = claimState.get(addr)
    claimState.set(addr, {
      lastClaim: Date.now(),
      totalClaims: (existing?.totalClaims ?? 0) + 1,
    })
  },

  // For testing
  clear(): void {
    claimState.clear()
    inFlightClaims.clear()
  },
}

const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
})

function getWalletClient() {
  const privateKey = FAUCET_CONFIG.faucetPrivateKey
  if (!privateKey) {
    throw new Error('FAUCET_PRIVATE_KEY not configured')
  }
  if (!isHexString(privateKey)) {
    throw new Error('FAUCET_PRIVATE_KEY must be a hex string starting with 0x')
  }
  const account = privateKeyToAccount(privateKey)
  return createWalletClient({
    account,
    chain,
    transport: http(RPC_URL),
  })
}

const IDENTITY_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

async function isRegisteredAgent(address: Address): Promise<boolean> {
  // Skip registry check in test mode or if explicitly skipped
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.FAUCET_SKIP_REGISTRY === 'true'
  ) {
    return true
  }

  // No registry configured - allow all
  if (FAUCET_CONFIG.identityRegistryAddress === ZERO_ADDRESS) {
    return true
  }

  const balance = await publicClient.readContract({
    address: FAUCET_CONFIG.identityRegistryAddress,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'balanceOf',
    args: [address],
  })

  return balance > 0n
}

function getCooldownRemaining(address: string): number {
  const lastClaim = faucetState.getLastClaim(address)
  if (!lastClaim) return 0
  return Math.max(0, FAUCET_CONFIG.cooldownMs - (Date.now() - lastClaim))
}

async function getFaucetBalance(): Promise<bigint> {
  // No token configured
  if (FAUCET_CONFIG.jejuTokenAddress === ZERO_ADDRESS) {
    return 0n
  }

  // No faucet wallet configured
  if (!FAUCET_CONFIG.faucetPrivateKey) {
    return 0n
  }

  const privateKey = FAUCET_CONFIG.faucetPrivateKey
  if (!privateKey || !isHexString(privateKey)) {
    return 0n
  }
  const account = privateKeyToAccount(privateKey)

  return publicClient.readContract({
    address: FAUCET_CONFIG.jejuTokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  })
}

export function isFaucetConfigured(): boolean {
  return Boolean(
    FAUCET_CONFIG.faucetPrivateKey &&
      FAUCET_CONFIG.jejuTokenAddress !== ZERO_ADDRESS,
  )
}

export async function getFaucetStatus(address: Address): Promise<FaucetStatus> {
  const validated = expectAddress(address, 'getFaucetStatus address')

  const [isRegistered, faucetBalance] = await Promise.all([
    isRegisteredAgent(validated),
    getFaucetBalance(),
  ])

  const cooldownRemaining = getCooldownRemaining(validated)
  const lastClaim = faucetState.getLastClaim(validated)

  const eligible =
    isRegistered &&
    cooldownRemaining === 0 &&
    faucetBalance >= FAUCET_CONFIG.amountPerClaim &&
    isFaucetConfigured()

  return {
    eligible,
    isRegistered,
    cooldownRemaining,
    nextClaimAt: lastClaim ? lastClaim + FAUCET_CONFIG.cooldownMs : null,
    amountPerClaim: formatEther(FAUCET_CONFIG.amountPerClaim),
    faucetBalance: formatEther(faucetBalance),
  }
}

export async function claimFromFaucet(
  address: Address,
): Promise<FaucetClaimResult> {
  const validated = expectAddress(address, 'claimFromFaucet address')

  // Check faucet is configured
  if (!isFaucetConfigured()) {
    throw new Error('Faucet not configured')
  }

  // Race condition protection: Check if claim already in progress
  if (faucetState.isClaimInProgress(validated)) {
    throw new Error('Claim already in progress for this address')
  }

  // Check registration
  const isRegistered = await isRegisteredAgent(validated)
  if (!isRegistered) {
    throw new Error(
      'Address must be registered in the ERC-8004 Identity Registry',
    )
  }

  // Check cooldown
  const cooldownRemaining = getCooldownRemaining(validated)
  if (cooldownRemaining > 0) {
    throw new Error(
      `Faucet cooldown active: ${Math.ceil(cooldownRemaining / 3600000)}h remaining`,
    )
  }

  // Check balance
  const faucetBalance = await getFaucetBalance()
  if (faucetBalance < FAUCET_CONFIG.amountPerClaim) {
    throw new Error('Faucet is empty, please try again later')
  }

  // Check token configured
  if (FAUCET_CONFIG.jejuTokenAddress === ZERO_ADDRESS) {
    throw new Error('JEJU token not configured')
  }

  // Race condition protection: Mark claim as in progress
  if (!faucetState.startClaim(validated)) {
    throw new Error('Claim already in progress for this address')
  }

  // Execute transfer with proper error handling
  try {
    const walletClient = getWalletClient()
    const hash = await walletClient.writeContract({
      address: FAUCET_CONFIG.jejuTokenAddress,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [validated, FAUCET_CONFIG.amountPerClaim],
    })

    // Record successful claim
    faucetState.finishClaim(validated, true)

    return {
      success: true,
      txHash: hash,
      amount: formatEther(FAUCET_CONFIG.amountPerClaim),
    }
  } catch (error) {
    // Clear in-flight flag on failure
    faucetState.finishClaim(validated, false)
    throw error
  }
}

export function getFaucetInfo(): FaucetInfo {
  return {
    name: `${NETWORK_NAME} Faucet`,
    description:
      'Get JEJU tokens for testing. Requires ERC-8004 registry registration.',
    tokenSymbol: 'JEJU',
    amountPerClaim: formatEther(FAUCET_CONFIG.amountPerClaim),
    cooldownHours: FAUCET_CONFIG.cooldownMs / (60 * 60 * 1000),
    requirements: [
      'Wallet must be registered in ERC-8004 Identity Registry',
      '12 hour cooldown between claims',
    ],
    chainId: CHAIN_ID,
    chainName: NETWORK_NAME,
    explorerUrl: EXPLORER_URL,
    isConfigured: isFaucetConfigured(),
  }
}

export function formatCooldownTime(ms: number): string {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

// Export service object for convenience
export const faucetService = {
  getFaucetStatus,
  claimFromFaucet,
  getFaucetInfo,
  isFaucetConfigured,
  formatCooldownTime,
}

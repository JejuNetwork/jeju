/**
 * Faucet Service for Bazaar
 * Provides JEJU tokens for local development and testing
 */

import { z } from 'zod'
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  parseEther,
  formatEther,
  erc20Abi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { AddressSchema } from '@jejunetwork/types'
import { expectAddress } from '@/lib/validation'
import { CHAIN_ID, RPC_URL, CONTRACTS, NETWORK_NAME, NETWORK, EXPLORER_URL } from '@/config'

// =============================================================================
// Configuration
// =============================================================================

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

// =============================================================================
// Schemas
// =============================================================================

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

// =============================================================================
// State Management (In-memory for local development)
// =============================================================================

interface FaucetClaim {
  lastClaim: number
  totalClaims: number
}

const claimState = new Map<string, FaucetClaim>()

export const faucetState = {
  getLastClaim(address: string): number | null {
    const claim = claimState.get(address.toLowerCase())
    return claim?.lastClaim ?? null
  },

  recordClaim(address: string): void {
    const addr = address.toLowerCase()
    const existing = claimState.get(addr)
    claimState.set(addr, {
      lastClaim: Date.now(),
      totalClaims: (existing?.totalClaims ?? 0) + 1,
    })
  },

  // For testing
  clear(): void {
    claimState.clear()
  },
}

// =============================================================================
// Clients
// =============================================================================

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
})

function getWalletClient() {
  const privateKey = FAUCET_CONFIG.faucetPrivateKey
  if (!privateKey) {
    throw new Error('FAUCET_PRIVATE_KEY not configured')
  }
  const account = privateKeyToAccount(privateKey as `0x${string}`)
  return createWalletClient({
    account,
    chain,
    transport: http(RPC_URL),
  })
}

// =============================================================================
// Identity Registry Check
// =============================================================================

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
  if (process.env.NODE_ENV === 'test' || process.env.FAUCET_SKIP_REGISTRY === 'true') {
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

// =============================================================================
// Cooldown Management
// =============================================================================

function getCooldownRemaining(address: string): number {
  const lastClaim = faucetState.getLastClaim(address)
  if (!lastClaim) return 0
  return Math.max(0, FAUCET_CONFIG.cooldownMs - (Date.now() - lastClaim))
}

// =============================================================================
// Faucet Balance
// =============================================================================

async function getFaucetBalance(): Promise<bigint> {
  // No token configured
  if (FAUCET_CONFIG.jejuTokenAddress === ZERO_ADDRESS) {
    return 0n
  }

  // No faucet wallet configured
  if (!FAUCET_CONFIG.faucetPrivateKey) {
    return 0n
  }

  const account = privateKeyToAccount(FAUCET_CONFIG.faucetPrivateKey as `0x${string}`)

  return publicClient.readContract({
    address: FAUCET_CONFIG.jejuTokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  })
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Check if faucet is properly configured for use
 */
export function isFaucetConfigured(): boolean {
  return Boolean(
    FAUCET_CONFIG.faucetPrivateKey && FAUCET_CONFIG.jejuTokenAddress !== ZERO_ADDRESS
  )
}

/**
 * Get faucet status for an address
 */
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

/**
 * Claim tokens from the faucet
 */
export async function claimFromFaucet(address: Address): Promise<FaucetClaimResult> {
  const validated = expectAddress(address, 'claimFromFaucet address')

  // Check faucet is configured
  if (!isFaucetConfigured()) {
    throw new Error('Faucet not configured: FAUCET_PRIVATE_KEY required')
  }

  // Check registration
  const isRegistered = await isRegisteredAgent(validated)
  if (!isRegistered) {
    throw new Error('Address must be registered in the ERC-8004 Identity Registry')
  }

  // Check cooldown
  const cooldownRemaining = getCooldownRemaining(validated)
  if (cooldownRemaining > 0) {
    throw new Error(`Faucet cooldown active: ${Math.ceil(cooldownRemaining / 3600000)}h remaining`)
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

  // Execute transfer
  const walletClient = getWalletClient()
  const hash = await walletClient.writeContract({
    address: FAUCET_CONFIG.jejuTokenAddress,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [validated, FAUCET_CONFIG.amountPerClaim],
  })

  // Record claim
  faucetState.recordClaim(validated)

  return {
    success: true,
    txHash: hash,
    amount: formatEther(FAUCET_CONFIG.amountPerClaim),
  }
}

/**
 * Get faucet information
 */
export function getFaucetInfo(): FaucetInfo {
  return {
    name: `${NETWORK_NAME} Faucet`,
    description: 'Get JEJU tokens for testing. Requires ERC-8004 registry registration.',
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

/**
 * Format time in milliseconds to human readable string
 */
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

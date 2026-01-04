import {
  getContractsConfig,
  getCurrentNetwork,
  getRpcUrl,
  getServicesConfig,
  isProductionEnv,
  isTestMode,
} from '@jejunetwork/config'
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
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'
import {
  createKMSWalletClient,
  isKMSAvailable,
  type KMSWalletClient,
} from './shared/kms-wallet'

// Get network from config
const NETWORK = getCurrentNetwork()
const contracts = getContractsConfig(NETWORK)
const services = getServicesConfig(NETWORK)

// Chain ID mapping
const CHAIN_IDS = {
  localnet: 31337,
  testnet: 420690,
  mainnet: 420691,
} as const

const CHAIN_ID = CHAIN_IDS[NETWORK]
const RPC_URL = getRpcUrl(NETWORK)
const NETWORK_NAME =
  NETWORK === 'mainnet'
    ? 'Jeju Mainnet'
    : NETWORK === 'testnet'
      ? 'Jeju Testnet'
      : 'Jeju Localnet'
const EXPLORER_URL = services.explorer || ''

/** Helper to get address or zero address */
function addr(value: string | undefined): Address {
  return (value as Address) || ZERO_ADDRESS
}

const FAUCET_CONFIG = {
  cooldownMs: 12 * 60 * 60 * 1000, // 12 hours
  amountPerClaim: parseEther('100'),
  jejuTokenAddress: addr(contracts.tokens.jeju),
  identityRegistryAddress: addr(contracts.registry.identity),
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
  isMainnet: z.boolean(),
})

export const ClaimRequestSchema = z.object({
  address: AddressSchema,
})

export type FaucetStatus = z.infer<typeof FaucetStatusSchema>
export type FaucetClaimResult = z.infer<typeof FaucetClaimResultSchema>
export type FaucetInfo = z.infer<typeof FaucetInfoSchema>

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

let cachedWalletClient: WalletClient | KMSWalletClient | null = null

async function getWalletClient(): Promise<WalletClient | KMSWalletClient> {
  if (cachedWalletClient) return cachedWalletClient

  const isProduction = isProductionEnv()

  // In production, MUST use KMS - no direct private keys
  const kmsKeyId =
    typeof process !== 'undefined' ? process.env.FAUCET_KMS_KEY_ID : undefined
  const ownerAddress = (
    typeof process !== 'undefined'
      ? process.env.FAUCET_OWNER_ADDRESS
      : undefined
  ) as Address | undefined

  if (isProduction) {
    if (!kmsKeyId || !ownerAddress) {
      throw new Error(
        'SECURITY: FAUCET_KMS_KEY_ID and FAUCET_OWNER_ADDRESS required in production. ' +
        'Direct private keys (FAUCET_PRIVATE_KEY) are not allowed in production.',
      )
    }
    const kmsAvailable = await isKMSAvailable()
    if (!kmsAvailable) {
      throw new Error('KMS not available - cannot start faucet in production without KMS')
    }
    cachedWalletClient = await createKMSWalletClient({
      chain,
      rpcUrl: RPC_URL,
      kmsKeyId,
      ownerAddress,
    })
    console.log('[Faucet] Using KMS-backed signing (production)')
    return cachedWalletClient
  }

  // Development: Try KMS first, then fallback to direct key
  if (kmsKeyId && ownerAddress) {
    const kmsAvailable = await isKMSAvailable()
    if (kmsAvailable) {
      cachedWalletClient = await createKMSWalletClient({
        chain,
        rpcUrl: RPC_URL,
        kmsKeyId,
        ownerAddress,
      })
      console.log('[Faucet] Using KMS-backed signing')
      return cachedWalletClient
    }
  }

  // Development fallback to direct key (fetched at runtime, not stored in config)
  const privateKey = process.env.FAUCET_PRIVATE_KEY
  if (!privateKey) {
    throw new Error(
      'Faucet not configured. Set FAUCET_KMS_KEY_ID + FAUCET_OWNER_ADDRESS for KMS, ' +
      'or FAUCET_PRIVATE_KEY for development only.',
    )
  }
  if (!isHexString(privateKey)) {
    throw new Error('FAUCET_PRIVATE_KEY must be a hex string starting with 0x')
  }

  console.warn(
    '[Faucet] WARNING: Using direct FAUCET_PRIVATE_KEY. Use KMS in production.',
  )

  const account = privateKeyToAccount(privateKey)
  cachedWalletClient = createWalletClient({
    account,
    chain,
    transport: http(RPC_URL),
  })
  return cachedWalletClient
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
  // Skip registry check in test mode
  if (isTestMode()) {
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

  // Get wallet client to determine faucet address
  try {
    const walletClient = await getWalletClient()
    if (!walletClient.account) {
      return 0n
    }

    return publicClient.readContract({
      address: FAUCET_CONFIG.jejuTokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [walletClient.account.address],
    })
  } catch {
    // Wallet not configured
    return 0n
  }
}

/**
 * Check if faucet is configured and available.
 * Returns false on mainnet - faucet is testnet only.
 */
export function isFaucetConfigured(): boolean {
  // IMPORTANT: No faucet on mainnet
  if (NETWORK === 'mainnet') {
    return false
  }

  // Check for KMS or direct key configuration
  const hasKmsConfig = !!(
    process.env.FAUCET_KMS_KEY_ID &&
    process.env.FAUCET_OWNER_ADDRESS
  )
  const hasDirectKey = !!process.env.FAUCET_PRIVATE_KEY

  return Boolean(
    (hasKmsConfig || hasDirectKey) &&
      FAUCET_CONFIG.jejuTokenAddress !== ZERO_ADDRESS,
  )
}

/**
 * Check if this is mainnet (faucet disabled)
 */
export function isMainnet(): boolean {
  return NETWORK === 'mainnet'
}

export async function getFaucetStatus(address: Address): Promise<FaucetStatus> {
  const validated = expectAddress(address, 'getFaucetStatus address')

  // On mainnet, always return ineligible
  if (NETWORK === 'mainnet') {
    return {
      eligible: false,
      isRegistered: false,
      cooldownRemaining: 0,
      nextClaimAt: null,
      amountPerClaim: '0',
      faucetBalance: '0',
    }
  }

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

  // IMPORTANT: No faucet on mainnet
  if (NETWORK === 'mainnet') {
    throw new Error('Faucet is not available on mainnet')
  }

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

  // Execute transfer
  const walletClient = await getWalletClient()
  if (!walletClient.account) {
    throw new Error('Wallet client has no account configured')
  }
  const hash = await walletClient.writeContract({
    address: FAUCET_CONFIG.jejuTokenAddress,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [validated, FAUCET_CONFIG.amountPerClaim],
    account: walletClient.account,
    chain,
  })

  // Record successful claim
  faucetState.finishClaim(validated, true)

  return {
    success: true,
    txHash: hash,
    amount: formatEther(FAUCET_CONFIG.amountPerClaim),
  }
}

export function getFaucetInfo(): FaucetInfo {
  const isMainnetNetwork = NETWORK === 'mainnet'

  return {
    name: `${NETWORK_NAME} Faucet`,
    description: isMainnetNetwork
      ? 'Faucet is not available on mainnet.'
      : 'Get JEJU tokens for testing. Requires ERC-8004 registry registration.',
    tokenSymbol: 'JEJU',
    amountPerClaim: isMainnetNetwork
      ? '0'
      : formatEther(FAUCET_CONFIG.amountPerClaim),
    cooldownHours: FAUCET_CONFIG.cooldownMs / (60 * 60 * 1000),
    requirements: isMainnetNetwork
      ? ['Faucet is disabled on mainnet']
      : [
          'Wallet must be registered in ERC-8004 Identity Registry',
          '12 hour cooldown between claims',
        ],
    chainId: CHAIN_ID,
    chainName: NETWORK_NAME,
    explorerUrl: EXPLORER_URL,
    isConfigured: isFaucetConfigured(),
    isMainnet: isMainnetNetwork,
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
  isMainnet,
  formatCooldownTime,
}

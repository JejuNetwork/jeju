import {
  BanType,
  createModerationAPI,
  type ModerationConfig,
  getBanTypeLabel as sharedGetBanTypeLabel,
} from '@jejunetwork/shared'
import { type Address, createPublicClient, http } from 'viem'
import { CONTRACTS, RPC_URL } from '../config'
import { jeju } from '../config/chains'

export { BanType }

export interface BanCheckResult {
  allowed: boolean
  reason?: string
  banType?: BanType
  networkBanned?: boolean
  appBanned?: boolean
  onNotice?: boolean
  caseId?: string
  canAppeal?: boolean
}

const isZero = (addr: string) =>
  addr === '0x0000000000000000000000000000000000000000'

const config: ModerationConfig = {
  chain: jeju,
  rpcUrl: RPC_URL,
  banManagerAddress: isZero(CONTRACTS.banManager)
    ? undefined
    : CONTRACTS.banManager,
  moderationMarketplaceAddress: isZero(CONTRACTS.moderationMarketplace)
    ? undefined
    : CONTRACTS.moderationMarketplace,
  reportingSystemAddress: isZero(CONTRACTS.reportingSystem)
    ? undefined
    : CONTRACTS.reportingSystem,
  reputationLabelManagerAddress: isZero(CONTRACTS.reputationLabelManager)
    ? undefined
    : CONTRACTS.reputationLabelManager,
}

const moderationAPI = createModerationAPI(config)

const publicClient = createPublicClient({
  chain: jeju,
  transport: http(RPC_URL),
})

const JEJU_TOKEN_ADDRESS = isZero(CONTRACTS.jeju) ? undefined : CONTRACTS.jeju
const JEJU_TOKEN_ABI = [
  {
    name: 'isBanned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'banEnforcementEnabled',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

interface CacheEntry {
  result: BanCheckResult
  cachedAt: number
}

const MAX_CACHE_SIZE = 10000
const banCache = new Map<string, CacheEntry>()
const CACHE_TTL = 10000 // 10 seconds

const inFlightRequests = new Map<string, Promise<BanCheckResult>>()

export async function checkUserBan(
  userAddress: Address,
): Promise<BanCheckResult> {
  const cacheKey = userAddress.toLowerCase()

  // Check cache first
  const cached = banCache.get(cacheKey)
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.result
  }

  // Check if request is already in-flight (prevents duplicate concurrent requests)
  const inFlight = inFlightRequests.get(cacheKey)
  if (inFlight) {
    return inFlight
  }

  // Create and track the request
  const requestPromise = (async (): Promise<BanCheckResult> => {
    const status = await moderationAPI.checkBanStatus(userAddress)

    // Map string banType to enum - handle both string keys and numeric strings
    const banTypeMap: Record<string, BanType> = {
      NONE: BanType.NONE,
      ON_NOTICE: BanType.ON_NOTICE,
      CHALLENGED: BanType.CHALLENGED,
      PERMANENT: BanType.PERMANENT,
      '0': BanType.NONE,
      '1': BanType.ON_NOTICE,
      '2': BanType.CHALLENGED,
      '3': BanType.PERMANENT,
    }
    const banTypeValue = banTypeMap[status.banType.toUpperCase()]

    const result: BanCheckResult = {
      allowed: !status.isBanned,
      reason: status.reason,
      banType: banTypeValue,
      onNotice: status.isOnNotice,
      canAppeal: status.canAppeal,
    }

    // Evict oldest entry if at capacity
    if (banCache.size >= MAX_CACHE_SIZE) {
      const firstKey = banCache.keys().next().value
      if (firstKey) banCache.delete(firstKey)
    }

    banCache.set(cacheKey, { result, cachedAt: Date.now() })
    return result
  })()

  // Track the in-flight request
  inFlightRequests.set(cacheKey, requestPromise)

  try {
    return await requestPromise
  } finally {
    // Clean up in-flight tracking
    inFlightRequests.delete(cacheKey)
  }
}

export async function isTradeAllowed(userAddress: Address): Promise<boolean> {
  const result = await checkUserBan(userAddress)
  return result.allowed
}

export async function checkTransferAllowed(
  userAddress: Address,
): Promise<boolean> {
  if (!JEJU_TOKEN_ADDRESS) return true

  const enforcementEnabled = await publicClient.readContract({
    address: JEJU_TOKEN_ADDRESS,
    abi: JEJU_TOKEN_ABI,
    functionName: 'banEnforcementEnabled',
  })

  if (!enforcementEnabled) return true

  const isBanned = await publicClient.readContract({
    address: JEJU_TOKEN_ADDRESS,
    abi: JEJU_TOKEN_ABI,
    functionName: 'isBanned',
    args: [userAddress],
  })

  return !isBanned
}

export async function checkTradeAllowed(
  userAddress: Address,
): Promise<BanCheckResult> {
  const generalResult = await checkUserBan(userAddress)
  if (!generalResult.allowed) return generalResult

  const jejuAllowed = await checkTransferAllowed(userAddress)
  if (!jejuAllowed) {
    return {
      allowed: false,
      reason: 'Banned from JEJU token transfers',
      networkBanned: true,
    }
  }

  return { allowed: true }
}

export const getBanTypeLabel = sharedGetBanTypeLabel

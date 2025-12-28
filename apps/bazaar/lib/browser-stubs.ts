import {
  getContractsConfig,
  getCurrentNetwork,
  getRpcUrl,
} from '@jejunetwork/config'
import { asTuple, BanType } from '@jejunetwork/types'
import { useCallback, useEffect, useState } from 'react'
import {
  type Address,
  createPublicClient,
  type Hex,
  http,
  parseAbiItem,
} from 'viem'
import { base, baseSepolia } from 'viem/chains'

export { BanType }
export type { BanType as BanTypeValue }

function toBanType(value: number): BanType {
  if (value < 0 || value > 3) throw new Error(`Invalid BanType: ${value}`)
  return value as BanType
}

export interface BanStatus {
  isBanned: boolean
  isOnNotice: boolean
  banType: BanType
  reason: string | null
  caseId: Hex | null
  loading: boolean
  canAppeal: boolean
  error: string | null
}

const network = getCurrentNetwork()
const contracts = getContractsConfig(network)
const isMainnet = network === 'mainnet'

const NETWORK_CONFIG = {
  chain: isMainnet ? base : baseSepolia,
  rpcUrl: getRpcUrl(network),
  banManager: (contracts.moderation.banManager as Address) || null,
  moderationMarketplace:
    (contracts.moderation.moderationMarketplace as Address) || null,
} as const

function getNetworkConfig() {
  return NETWORK_CONFIG
}

const BAN_MANAGER_FRAGMENT = parseAbiItem(
  'function isAddressBanned(address) view returns (bool)',
)
const ON_NOTICE_FRAGMENT = parseAbiItem(
  'function isOnNotice(address) view returns (bool)',
)
const GET_BAN_FRAGMENT = parseAbiItem(
  'function getAddressBan(address) view returns (bool isBanned, uint8 banType, string reason, bytes32 caseId)',
)

export function useBanStatus(address: Address | undefined): BanStatus {
  const [status, setStatus] = useState<BanStatus>({
    isBanned: false,
    isOnNotice: false,
    banType: BanType.NONE,
    reason: null,
    caseId: null,
    loading: true,
    canAppeal: false,
    error: null,
  })

  const checkBanStatus = useCallback(async () => {
    if (!address) {
      setStatus((prev) => ({ ...prev, loading: false }))
      return
    }

    const config = getNetworkConfig()

if (!config.banManager) {
      setStatus({
        isBanned: false,
        isOnNotice: false,
        banType: BanType.NONE,
        reason: null,
        caseId: null,
        loading: false,
        canAppeal: false,
        error: null,
      })
      return
    }

    const client = createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    })

    const [isAddressBanned, isOnNotice] = await Promise.all([
      client.readContract({
        address: config.banManager,
        abi: [BAN_MANAGER_FRAGMENT],
        functionName: 'isAddressBanned',
        args: [address],
      }),
      client.readContract({
        address: config.banManager,
        abi: [ON_NOTICE_FRAGMENT],
        functionName: 'isOnNotice',
        args: [address],
      }),
    ])

    if (isAddressBanned || isOnNotice) {
      const ban = await client.readContract({
        address: config.banManager,
        abi: [GET_BAN_FRAGMENT],
        functionName: 'getAddressBan',
        args: [address],
      })

const result = asTuple<readonly [boolean, number, string, Hex]>(ban, 4)
      const banTypeNum = result[1]
      const reason = result[2]
      const caseId = result[3]
      const banType = toBanType(banTypeNum)

      setStatus({
        isBanned: Boolean(isAddressBanned),
        isOnNotice: Boolean(isOnNotice),
        banType,
        reason:
          reason ||
          (isOnNotice
            ? 'Account on notice - pending review'
            : 'Banned from network'),
        caseId,
        loading: false,
        canAppeal: banTypeNum === BanType.PERMANENT,
        error: null,
      })
      return
    }

setStatus({
      isBanned: false,
      isOnNotice: false,
      banType: BanType.NONE,
      reason: null,
      caseId: null,
      loading: false,
      canAppeal: false,
      error: null,
    })
  }, [address])

  useEffect(() => {
    checkBanStatus()

const interval = setInterval(checkBanStatus, 30000)
    return () => clearInterval(interval)
  }, [checkBanStatus])

  return status
}

export function getBanTypeLabel(banType: BanType): string {
  switch (banType) {
    case BanType.NONE:
      return 'None'
    case BanType.ON_NOTICE:
      return 'On Notice'
    case BanType.CHALLENGED:
      return 'Challenged'
    case BanType.PERMANENT:
      return 'Permanently Banned'
    default:
      return 'Unknown'
  }
}

export interface OAuth3Config {
  appId: string
  redirectUri: string
  chainId: number
  rpcUrl: string
  teeAgentUrl?: string
  decentralized?: boolean
}

export interface OAuth3Session {
  identityId: string
  smartAccountAddress: string
  providers: string[]
}

export interface OAuth3ContextValue {
  session: OAuth3Session | null
  isLoading: boolean
  isAuthenticated: boolean
  error: string | null
  login: () => Promise<void>
  logout: () => Promise<void>
}

export interface IPFSClient {
  upload: (file: File, options?: { durationMonths?: number }) => Promise<string>
  uploadJSON: (
    data: Record<string, unknown>,
    filename: string,
  ) => Promise<string>
  getUrl: (hash: string) => string
}

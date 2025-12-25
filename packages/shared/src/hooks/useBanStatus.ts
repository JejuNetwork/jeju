/**
 * Shared Ban Status Hook
 * Used across all network apps to check and display user ban status
 */

import { readContract } from '@jejunetwork/contracts'
import { BanType } from '@jejunetwork/types'
import { useCallback, useEffect, useState } from 'react'
import { type Address, createPublicClient, http, type PublicClient } from 'viem'
import { baseSepolia } from 'viem/chains'
import { BAN_MANAGER_ABI, MODERATION_MARKETPLACE_ABI } from '../api/abis'

export { BanType }

export interface BanStatus {
  isBanned: boolean
  banType: BanType
  isOnNotice: boolean
  reason: string
  caseId: `0x${string}` | null
  canAppeal: boolean
  loading: boolean
  error: string | null
}

export interface BanCheckConfig {
  banManagerAddress?: Address
  moderationMarketplaceAddress?: Address
  identityRegistryAddress?: Address
  appId?: `0x${string}`
  rpcUrl?: string
}

/** Address ban data from BanManager contract */
interface AddressBanData {
  isBanned: boolean
  banType: number
  reason: string
  caseId: `0x${string}`
}

// Get RPC URL with network-aware defaults
function getDefaultRpcUrl(): string {
  const network =
    process.env.PUBLIC_NETWORK || process.env.VITE_NETWORK || 'localnet'
  const envRpc =
    process.env.PUBLIC_RPC_URL ||
    process.env.PUBLIC_JEJU_RPC_URL ||
    process.env.VITE_RPC_URL
  if (envRpc) return envRpc

  switch (network) {
    case 'mainnet':
      return 'https://rpc.jejunetwork.org'
    case 'testnet':
      return 'https://testnet-rpc.jejunetwork.org'
    default:
      return 'http://localhost:6546'
  }
}

const DEFAULT_CONFIG: BanCheckConfig = {
  banManagerAddress: (process.env.PUBLIC_BAN_MANAGER_ADDRESS ||
    process.env.VITE_BAN_MANAGER_ADDRESS) as Address | undefined,
  moderationMarketplaceAddress: (process.env
    .PUBLIC_MODERATION_MARKETPLACE_ADDRESS ||
    process.env.VITE_MODERATION_MARKETPLACE_ADDRESS) as Address | undefined,
  identityRegistryAddress: (process.env.PUBLIC_IDENTITY_REGISTRY_ADDRESS ||
    process.env.VITE_IDENTITY_REGISTRY_ADDRESS) as Address | undefined,
  rpcUrl: getDefaultRpcUrl(),
}

/**
 * Hook to check and monitor user's ban status
 * @param userAddress - User's wallet address to check
 * @param config - Optional configuration for contract addresses
 * @returns BanStatus object with loading state and error handling
 */
export function useBanStatus(
  userAddress: Address | undefined,
  config: BanCheckConfig = DEFAULT_CONFIG,
): BanStatus {
  const [status, setStatus] = useState<BanStatus>({
    isBanned: false,
    banType: BanType.NONE,
    isOnNotice: false,
    reason: '',
    caseId: null,
    canAppeal: false,
    loading: true,
    error: null,
  })

  const checkBanStatus = useCallback(async () => {
    if (!userAddress) {
      setStatus((prev: BanStatus) => ({ ...prev, loading: false }))
      return
    }

    const mergedConfig = { ...DEFAULT_CONFIG, ...config }

    if (!mergedConfig.banManagerAddress) {
      setStatus((prev: BanStatus) => ({ ...prev, loading: false }))
      return
    }

    const client = createPublicClient({
      chain: baseSepolia,
      transport: http(mergedConfig.rpcUrl),
    }) as PublicClient

    try {
      // Check address-based ban
      const [isAddressBanned, isOnNotice, addressBan] = await Promise.all([
        readContract(client, {
          address: mergedConfig.banManagerAddress,
          abi: BAN_MANAGER_ABI,
          functionName: 'isAddressBanned',
          args: [userAddress],
        }).catch((): boolean => false),
        readContract(client, {
          address: mergedConfig.banManagerAddress,
          abi: BAN_MANAGER_ABI,
          functionName: 'isOnNotice',
          args: [userAddress],
        }).catch((): boolean => false),
        readContract(client, {
          address: mergedConfig.banManagerAddress,
          abi: BAN_MANAGER_ABI,
          functionName: 'getAddressBan',
          args: [userAddress],
        }).catch((): null => null),
      ])

      if (isAddressBanned || isOnNotice) {
        const ban = addressBan as AddressBanData | null

        setStatus({
          isBanned: true,
          banType: (ban?.banType as BanType) ?? BanType.PERMANENT,
          isOnNotice: isOnNotice,
          reason:
            ban?.reason ||
            (isOnNotice
              ? 'Account on notice - pending review'
              : 'Banned from network'),
          caseId: ban?.caseId ?? null,
          canAppeal: ban?.banType === BanType.PERMANENT,
          loading: false,
          error: null,
        })
        return
      }

      // Check ModerationMarketplace ban
      if (mergedConfig.moderationMarketplaceAddress) {
        const marketplaceBanned = await readContract(client, {
          address: mergedConfig.moderationMarketplaceAddress,
          abi: MODERATION_MARKETPLACE_ABI,
          functionName: 'isBanned',
          args: [userAddress],
        }).catch((): boolean => false)

        if (marketplaceBanned) {
          setStatus({
            isBanned: true,
            banType: BanType.PERMANENT,
            isOnNotice: false,
            reason: 'Banned via Moderation Marketplace',
            caseId: null,
            canAppeal: true,
            loading: false,
            error: null,
          })
          return
        }
      }

      // User is not banned
      setStatus({
        isBanned: false,
        banType: BanType.NONE,
        isOnNotice: false,
        reason: '',
        caseId: null,
        canAppeal: false,
        loading: false,
        error: null,
      })
    } catch (err) {
      setStatus((prev: BanStatus) => ({
        ...prev,
        loading: false,
        error:
          err instanceof Error ? err.message : 'Failed to check ban status',
      }))
    }
  }, [userAddress, config])

  useEffect(() => {
    checkBanStatus()

    // Re-check every 30 seconds
    const interval = setInterval(checkBanStatus, 30000)
    return () => clearInterval(interval)
  }, [checkBanStatus])

  return status
}

/**
 * Get human-readable ban type label
 */
export function getBanTypeLabel(banType: BanType): string {
  switch (banType) {
    case BanType.NONE:
      return 'Not Banned'
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

/**
 * Get color class for ban type
 */
export function getBanTypeColor(banType: BanType): string {
  switch (banType) {
    case BanType.NONE:
      return 'text-green-600 bg-green-50'
    case BanType.ON_NOTICE:
      return 'text-yellow-600 bg-yellow-50'
    case BanType.CHALLENGED:
      return 'text-orange-600 bg-orange-50'
    case BanType.PERMANENT:
      return 'text-red-600 bg-red-50'
    default:
      return 'text-gray-600 bg-gray-50'
  }
}

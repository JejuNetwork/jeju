/**
 * Ban Status Hook
 *
 * Uses @jejunetwork/config for all configuration.
 */

import {
  getContractsConfig,
  getCurrentNetwork,
  getRpcUrl,
} from '@jejunetwork/config'
import type {
  HookBanCheckConfig as BanCheckConfig,
  BanStatus,
} from '@jejunetwork/shared'
import { BanType } from '@jejunetwork/types'
import { useCallback, useEffect, useState } from 'react'
import { type Address, createPublicClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'

export { BanType }
export type { BanCheckConfig, BanStatus }

/** Contract return type for getAddressBan */
interface AddressBanData {
  isBanned: boolean
  banType: number
  reason: string
  caseId: `0x${string}`
}

const BAN_MANAGER_ABI = [
  {
    type: 'function',
    name: 'isAddressBanned',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isOnNotice',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAddressBan',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'isBanned', type: 'bool' },
          { name: 'banType', type: 'uint8' },
          { name: 'reason', type: 'string' },
          { name: 'caseId', type: 'bytes32' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const

const MODERATION_MARKETPLACE_ABI = [
  {
    type: 'function',
    name: 'isBanned',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
] as const

// Get config defaults from @jejunetwork/config
const network = getCurrentNetwork()
const contracts = getContractsConfig(network)

const DEFAULT_CONFIG: BanCheckConfig = {
  banManagerAddress: contracts.moderation.banManager as Address | undefined,
  moderationMarketplaceAddress: contracts.moderation.moderationMarketplace as
    | Address
    | undefined,
  identityRegistryAddress: contracts.registry.identity as Address | undefined,
  rpcUrl: getRpcUrl(network),
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
    })

    // Check address-based ban
    const [isAddressBanned, isOnNotice, addressBan] = await Promise.all([
      client.readContract({
        address: mergedConfig.banManagerAddress,
        abi: BAN_MANAGER_ABI,
        functionName: 'isAddressBanned',
        args: [userAddress],
      }).catch((): boolean => false),
      client.readContract({
        address: mergedConfig.banManagerAddress,
        abi: BAN_MANAGER_ABI,
        functionName: 'isOnNotice',
        args: [userAddress],
      }).catch((): boolean => false),
      client.readContract({
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
      const marketplaceBanned = await client.readContract({
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

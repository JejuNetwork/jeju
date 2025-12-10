/**
 * Shared Ban Status Hook
 * Used across all Jeju apps to check and display user ban status
 */

import { useEffect, useState, useCallback } from 'react';
import { Address, createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';

// ============ Types ============

export enum BanType {
  NONE = 0,
  ON_NOTICE = 1,
  CHALLENGED = 2,
  PERMANENT = 3
}

export interface BanStatus {
  isBanned: boolean;
  banType: BanType;
  isOnNotice: boolean;
  reason: string;
  caseId: `0x${string}` | null;
  canAppeal: boolean;
  loading: boolean;
  error: string | null;
}

export interface BanCheckConfig {
  banManagerAddress?: Address;
  moderationMarketplaceAddress?: Address;
  identityRegistryAddress?: Address;
  appId?: `0x${string}`;
  rpcUrl?: string;
}

// ============ ABIs ============

const BAN_MANAGER_ABI = [
  {
    name: 'isAddressBanned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'target', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'isOnNotice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'target', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getAddressBan',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'target', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'isBanned', type: 'bool' },
          { name: 'banType', type: 'uint8' },
          { name: 'bannedAt', type: 'uint256' },
          { name: 'expiresAt', type: 'uint256' },
          { name: 'reason', type: 'string' },
          { name: 'proposalId', type: 'bytes32' },
          { name: 'reporter', type: 'address' },
          { name: 'caseId', type: 'bytes32' },
        ],
      },
    ],
  },
] as const;

const MODERATION_MARKETPLACE_ABI = [
  {
    name: 'isBanned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

// ============ Default Config ============

// Get RPC URL with network-aware defaults
function getDefaultRpcUrl(): string {
  const network = process.env.NEXT_PUBLIC_NETWORK || process.env.VITE_NETWORK || 'localnet';
  const envRpc = process.env.NEXT_PUBLIC_RPC_URL || process.env.NEXT_PUBLIC_JEJU_RPC_URL || process.env.VITE_RPC_URL;
  if (envRpc) return envRpc;
  
  switch (network) {
    case 'mainnet': return 'https://rpc.jeju.network';
    case 'testnet': return 'https://testnet-rpc.jeju.network';
    default: return 'http://localhost:9545';
  }
}

const DEFAULT_CONFIG: BanCheckConfig = {
  banManagerAddress: (process.env.NEXT_PUBLIC_BAN_MANAGER_ADDRESS || process.env.VITE_BAN_MANAGER_ADDRESS) as Address | undefined,
  moderationMarketplaceAddress: (process.env.NEXT_PUBLIC_MODERATION_MARKETPLACE_ADDRESS || process.env.VITE_MODERATION_MARKETPLACE_ADDRESS) as Address | undefined,
  identityRegistryAddress: (process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS || process.env.VITE_IDENTITY_REGISTRY_ADDRESS) as Address | undefined,
  rpcUrl: getDefaultRpcUrl(),
};

// ============ Hook ============

/**
 * Hook to check and monitor user's ban status
 * @param userAddress - User's wallet address to check
 * @param config - Optional configuration for contract addresses
 * @returns BanStatus object with loading state and error handling
 */
export function useBanStatus(
  userAddress: Address | undefined,
  config: BanCheckConfig = DEFAULT_CONFIG
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
  });

  const checkBanStatus = useCallback(async () => {
    if (!userAddress) {
      setStatus((prev: BanStatus) => ({ ...prev, loading: false }));
      return;
    }

    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    
    if (!mergedConfig.banManagerAddress) {
      setStatus((prev: BanStatus) => ({ ...prev, loading: false }));
      return;
    }

    const client = createPublicClient({
      chain: baseSepolia,
      transport: http(mergedConfig.rpcUrl),
    });

    try {
      // Check address-based ban
      const [isAddressBanned, isOnNotice, addressBan] = await Promise.all([
        client.readContract({
          address: mergedConfig.banManagerAddress,
          abi: BAN_MANAGER_ABI,
          functionName: 'isAddressBanned',
          args: [userAddress],
        }).catch(() => false),
        client.readContract({
          address: mergedConfig.banManagerAddress,
          abi: BAN_MANAGER_ABI,
          functionName: 'isOnNotice',
          args: [userAddress],
        }).catch(() => false),
        client.readContract({
          address: mergedConfig.banManagerAddress,
          abi: BAN_MANAGER_ABI,
          functionName: 'getAddressBan',
          args: [userAddress],
        }).catch(() => null),
      ]);

      if (isAddressBanned || isOnNotice) {
        const ban = addressBan as {
          isBanned: boolean;
          banType: number;
          reason: string;
          caseId: `0x${string}`;
        } | null;

        setStatus({
          isBanned: true,
          banType: ban?.banType as BanType ?? BanType.PERMANENT,
          isOnNotice: isOnNotice,
          reason: ban?.reason || (isOnNotice ? 'Account on notice - pending review' : 'Banned from network'),
          caseId: ban?.caseId || null,
          canAppeal: ban?.banType === BanType.PERMANENT,
          loading: false,
          error: null,
        });
        return;
      }

      // Check ModerationMarketplace ban
      if (mergedConfig.moderationMarketplaceAddress) {
        const marketplaceBanned = await client.readContract({
          address: mergedConfig.moderationMarketplaceAddress,
          abi: MODERATION_MARKETPLACE_ABI,
          functionName: 'isBanned',
          args: [userAddress],
        }).catch(() => false);

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
          });
          return;
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
      });
    } catch (err) {
      setStatus((prev: BanStatus) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to check ban status',
      }));
    }
  }, [userAddress, config]);

  useEffect(() => {
    checkBanStatus();
    
    // Re-check every 30 seconds
    const interval = setInterval(checkBanStatus, 30000);
    return () => clearInterval(interval);
  }, [checkBanStatus]);

  return status;
}

/**
 * Get human-readable ban type label
 */
export function getBanTypeLabel(banType: BanType): string {
  switch (banType) {
    case BanType.NONE: return 'Not Banned';
    case BanType.ON_NOTICE: return 'On Notice';
    case BanType.CHALLENGED: return 'Challenged';
    case BanType.PERMANENT: return 'Permanently Banned';
    default: return 'Unknown';
  }
}

/**
 * Get color class for ban type
 */
export function getBanTypeColor(banType: BanType): string {
  switch (banType) {
    case BanType.NONE: return 'text-green-600 bg-green-50';
    case BanType.ON_NOTICE: return 'text-yellow-600 bg-yellow-50';
    case BanType.CHALLENGED: return 'text-orange-600 bg-orange-50';
    case BanType.PERMANENT: return 'text-red-600 bg-red-50';
    default: return 'text-gray-600 bg-gray-50';
  }
}

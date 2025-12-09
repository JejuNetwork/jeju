import { Address, createPublicClient, http } from 'viem';
import { jeju } from '../config/chains';

const BAN_MANAGER_ADDRESS = process.env.NEXT_PUBLIC_BAN_MANAGER_ADDRESS as Address | undefined;
const MODERATION_MARKETPLACE_ADDRESS = process.env.NEXT_PUBLIC_MODERATION_MARKETPLACE_ADDRESS as Address | undefined;
const IDENTITY_REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS as Address | undefined;
const BAZAAR_APP_ID = `0x${Buffer.from('bazaar').toString('hex').padEnd(64, '0')}` as `0x${string}`;

// ============ Types ============

export enum BanType {
  NONE = 0,
  ON_NOTICE = 1,
  CHALLENGED = 2,
  PERMANENT = 3
}

export interface ExtendedBanRecord {
  isBanned: boolean;
  banType: BanType;
  bannedAt: bigint;
  expiresAt: bigint;
  reason: string;
  proposalId: `0x${string}`;
  reporter: Address;
  caseId: `0x${string}`;
}

export interface BanCheckResult {
  allowed: boolean;
  reason?: string;
  banType?: BanType;
  networkBanned?: boolean;
  appBanned?: boolean;
  onNotice?: boolean;
  caseId?: string;
  canAppeal?: boolean;
}

// ============ ABIs ============

const BAN_MANAGER_ABI = [
  {
    name: 'isAccessAllowed',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'appId', type: 'bytes32' },
    ],
    outputs: [{ name: 'allowed', type: 'bool' }],
  },
  {
    name: 'isNetworkBanned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getBanReason',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'appId', type: 'bytes32' },
    ],
    outputs: [{ name: 'reason', type: 'string' }],
  },
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
    name: 'isPermanentlyBanned',
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
  {
    name: 'isAddressAccessAllowed',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'appId', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const IDENTITY_REGISTRY_ABI = [
  {
    name: 'addressToAgentId',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'entity', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
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
  {
    name: 'canReport',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getStake',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'amount', type: 'uint256' },
          { name: 'stakedAt', type: 'uint256' },
          { name: 'stakedBlock', type: 'uint256' },
          { name: 'lastActivityBlock', type: 'uint256' },
          { name: 'isStaked', type: 'bool' },
        ],
      },
    ],
  },
] as const;

// ============ Cache ============

interface CacheEntry {
  result: BanCheckResult;
  cachedAt: number;
}

const banCache = new Map<string, CacheEntry>();
const CACHE_TTL = 10000; // 10 seconds

// ============ Client ============

const publicClient = createPublicClient({
  chain: jeju,
  transport: http(),
});

// ============ Functions ============

/**
 * Check if a user is banned (address-based + agent-based)
 * Uses both BanManager and ModerationMarketplace
 */
export async function checkUserBan(userAddress: Address): Promise<BanCheckResult> {
  // Check cache first
  const cacheKey = userAddress.toLowerCase();
  const cached = banCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.result;
  }

  // Default to allowed if no contracts configured
  if (!BAN_MANAGER_ADDRESS) {
    return { allowed: true };
  }

  // Check address-based ban first (new system)
  const [isAddressBanned, isOnNotice, addressBan] = await Promise.all([
    publicClient.readContract({
      address: BAN_MANAGER_ADDRESS,
      abi: BAN_MANAGER_ABI,
      functionName: 'isAddressBanned',
      args: [userAddress],
    }).catch(() => false),
    publicClient.readContract({
      address: BAN_MANAGER_ADDRESS,
      abi: BAN_MANAGER_ABI,
      functionName: 'isOnNotice',
      args: [userAddress],
    }).catch(() => false),
    publicClient.readContract({
      address: BAN_MANAGER_ADDRESS,
      abi: BAN_MANAGER_ABI,
      functionName: 'getAddressBan',
      args: [userAddress],
    }).catch(() => null),
  ]);

  // If address is banned (any type), deny access
  if (isAddressBanned || isOnNotice) {
    const ban = addressBan as ExtendedBanRecord | null;
    const result: BanCheckResult = {
      allowed: false,
      reason: ban?.reason || 'Banned from network',
      banType: ban?.banType ?? BanType.PERMANENT,
      networkBanned: true,
      onNotice: isOnNotice,
      caseId: ban?.caseId,
      canAppeal: ban?.banType === BanType.PERMANENT,
    };
    banCache.set(cacheKey, { result, cachedAt: Date.now() });
    return result;
  }

  // Check agent-based ban (legacy system)
  if (IDENTITY_REGISTRY_ADDRESS) {
    const agentId = await publicClient.readContract({
      address: IDENTITY_REGISTRY_ADDRESS,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'addressToAgentId',
      args: [userAddress],
    }).catch(() => 0n);

    if (agentId && agentId !== 0n) {
      const allowed = await publicClient.readContract({
        address: BAN_MANAGER_ADDRESS,
        abi: BAN_MANAGER_ABI,
        functionName: 'isAccessAllowed',
        args: [agentId, BAZAAR_APP_ID],
      }).catch(() => true);

      if (!allowed) {
        const isNetworkBanned = await publicClient.readContract({
          address: BAN_MANAGER_ADDRESS,
          abi: BAN_MANAGER_ABI,
          functionName: 'isNetworkBanned',
          args: [agentId],
        }).catch(() => false);

        const reason = await publicClient.readContract({
          address: BAN_MANAGER_ADDRESS,
          abi: BAN_MANAGER_ABI,
          functionName: 'getBanReason',
          args: [agentId, isNetworkBanned ? '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}` : BAZAAR_APP_ID],
        }).catch(() => 'Banned');

        const result: BanCheckResult = {
          allowed: false,
          reason: reason || 'Banned',
          networkBanned: isNetworkBanned,
          appBanned: !isNetworkBanned,
        };
        banCache.set(cacheKey, { result, cachedAt: Date.now() });
        return result;
      }
    }
  }

  // Check ModerationMarketplace ban status
  if (MODERATION_MARKETPLACE_ADDRESS) {
    const marketplaceBanned = await publicClient.readContract({
      address: MODERATION_MARKETPLACE_ADDRESS,
      abi: MODERATION_MARKETPLACE_ABI,
      functionName: 'isBanned',
      args: [userAddress],
    }).catch(() => false);

    if (marketplaceBanned) {
      const result: BanCheckResult = {
        allowed: false,
        reason: 'Banned via Moderation Marketplace',
        networkBanned: true,
        canAppeal: true,
      };
      banCache.set(cacheKey, { result, cachedAt: Date.now() });
      return result;
    }
  }

  // User is allowed
  const result: BanCheckResult = { allowed: true };
  banCache.set(cacheKey, { result, cachedAt: Date.now() });
  return result;
}

/**
 * Check if user can trade on Bazaar
 */
export async function checkTradeAllowed(userAddress: Address): Promise<boolean> {
  const result = await checkUserBan(userAddress);
  return result.allowed;
}

/**
 * Check if user can report others (staked with aged stake)
 */
export async function checkCanReport(userAddress: Address): Promise<boolean> {
  if (!MODERATION_MARKETPLACE_ADDRESS) return false;

  return publicClient.readContract({
    address: MODERATION_MARKETPLACE_ADDRESS,
    abi: MODERATION_MARKETPLACE_ABI,
    functionName: 'canReport',
    args: [userAddress],
  }).catch(() => false);
}

/**
 * Get user's stake info from ModerationMarketplace
 */
export async function getUserStake(userAddress: Address): Promise<{
  amount: bigint;
  stakedAt: bigint;
  isStaked: boolean;
} | null> {
  if (!MODERATION_MARKETPLACE_ADDRESS) return null;

  const stake = await publicClient.readContract({
    address: MODERATION_MARKETPLACE_ADDRESS,
    abi: MODERATION_MARKETPLACE_ABI,
    functionName: 'getStake',
    args: [userAddress],
  }).catch(() => null);

  if (!stake) return null;

  return {
    amount: stake.amount,
    stakedAt: stake.stakedAt,
    isStaked: stake.isStaked,
  };
}

/**
 * Get ban type label for display
 */
export function getBanTypeLabel(banType: BanType): string {
  switch (banType) {
    case BanType.NONE: return 'Not Banned';
    case BanType.ON_NOTICE: return 'On Notice (Pending Review)';
    case BanType.CHALLENGED: return 'Challenged (Market Active)';
    case BanType.PERMANENT: return 'Permanently Banned';
    default: return 'Unknown';
  }
}

/**
 * Clear ban cache (useful after transactions)
 */
export function clearBanCache(userAddress?: Address): void {
  if (userAddress) {
    banCache.delete(userAddress.toLowerCase());
  } else {
    banCache.clear();
  }
}

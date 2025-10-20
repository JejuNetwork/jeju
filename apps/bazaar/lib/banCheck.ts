/**
 * Ban Check Utility for Bazaar
 * Checks if user is banned before allowing trades
 * Integrated with NetworkBanCache for performant checks
 */

import { Address, createPublicClient, http, PublicClient } from 'viem';
import { jeju } from '../config/chains';

// Import from auto-generated config
const BAN_MANAGER_ADDRESS = process.env.NEXT_PUBLIC_BAN_MANAGER_ADDRESS as Address | undefined;
const IDENTITY_REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS as Address | undefined;
const BAZAAR_APP_ID = `0x${Buffer.from('bazaar').toString('hex').padStart(64, '0')}` as `0x${string}`;

// In-memory cache for performance
const banCache = new Map<string, { banned: boolean; reason?: string; cachedAt: number }>();
const CACHE_TTL = 10000; // 10 seconds

export interface BanCheckResult {
  allowed: boolean;
  reason?: string;
  networkBanned?: boolean;
  appBanned?: boolean;
  labels?: string[];
}

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

// Get public client (cached)
let publicClient: PublicClient | null = null;

function getPublicClient(): PublicClient {
  if (!publicClient) {
    publicClient = createPublicClient({
      chain: jeju,
      transport: http(),
    });
  }
  return publicClient;
}

export async function checkUserBan(userAddress: Address): Promise<BanCheckResult> {
  if (!BAN_MANAGER_ADDRESS || !IDENTITY_REGISTRY_ADDRESS) {
    // Ban manager not deployed, allow access
    return { allowed: true };
  }

  // Check cache first
  const cacheKey = userAddress.toLowerCase();
  const cached = banCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return {
      allowed: !cached.banned,
      reason: cached.reason,
      networkBanned: cached.banned,
    };
  }

  try {
    const client = getPublicClient();

    // Step 1: Get agentId for address
    const agentId = await client.readContract({
      address: IDENTITY_REGISTRY_ADDRESS,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'addressToAgentId',
      args: [userAddress],
    });

    if (!agentId || agentId === 0n) {
      // Not registered, allow access (will register on first transaction)
      return { allowed: true };
    }

    // Step 2: Check if access allowed
    const allowed = await client.readContract({
      address: BAN_MANAGER_ADDRESS,
      abi: BAN_MANAGER_ABI,
      functionName: 'isAccessAllowed',
      args: [agentId, BAZAAR_APP_ID],
    });

    if (allowed) {
      // Cache as allowed
      banCache.set(cacheKey, { banned: false, cachedAt: Date.now() });
      return { allowed: true };
    }

    // Step 3: Get ban details
    const isNetworkBanned = await client.readContract({
      address: BAN_MANAGER_ADDRESS,
      abi: BAN_MANAGER_ABI,
      functionName: 'isNetworkBanned',
      args: [agentId],
    });

    const reason = await client.readContract({
      address: BAN_MANAGER_ADDRESS,
      abi: BAN_MANAGER_ABI,
      functionName: 'getBanReason',
      args: [agentId, isNetworkBanned ? '0x0000000000000000000000000000000000000000000000000000000000000000' : BAZAAR_APP_ID],
    });

    // Cache as banned
    banCache.set(cacheKey, { banned: true, reason: reason || undefined, cachedAt: Date.now() });

    return {
      allowed: false,
      reason: reason || 'You have been banned from trading.',
      networkBanned: isNetworkBanned,
      appBanned: !isNetworkBanned,
    };
  } catch (error) {
    console.error('[BanCheck] Error checking ban status:', error);
    // Fail open - allow access if check fails (prevents DoS)
    return { allowed: true };
  }
}

export async function checkTradeAllowed(userAddress: Address): Promise<boolean> {
  const result = await checkUserBan(userAddress);
  return result.allowed;
}



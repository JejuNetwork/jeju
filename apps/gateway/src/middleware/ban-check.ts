/**
 * Ban Check Middleware for Gateway
 * 
 * Blocks banned users from accessing gateway services.
 * Uses fail-closed security model.
 */

import type { Request, Response, NextFunction } from 'express';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import { BAN_MANAGER_ADDRESS, MODERATION_MARKETPLACE_ADDRESS } from '../config/contracts.js';
import { getRpcUrl } from '../config/networks.js';

// ============ Types ============

interface BanCacheEntry {
  isBanned: boolean;
  isOnNotice: boolean;
  reason: string;
  caseId: Hex | null;
  timestamp: number;
}

interface BanCheckOptions {
  failClosed?: boolean;
  cacheTtlMs?: number;
  skipPaths?: string[];
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

// ============ Cache ============

const banCache = new Map<string, BanCacheEntry>();
const DEFAULT_CACHE_TTL = 30000; // 30 seconds

// ============ Public Client ============

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(getRpcUrl(84532)),
});

// ============ Core Function ============

async function checkBan(address: Address, cacheTtlMs: number): Promise<BanCacheEntry> {
  const cacheKey = address.toLowerCase();
  const cached = banCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < cacheTtlMs) {
    return cached;
  }

  const [isBanned, isOnNotice, banRecord] = await Promise.all([
    publicClient.readContract({
      address: BAN_MANAGER_ADDRESS,
      abi: BAN_MANAGER_ABI,
      functionName: 'isAddressBanned',
      args: [address],
    }),
    publicClient.readContract({
      address: BAN_MANAGER_ADDRESS,
      abi: BAN_MANAGER_ABI,
      functionName: 'isOnNotice',
      args: [address],
    }),
    publicClient.readContract({
      address: BAN_MANAGER_ADDRESS,
      abi: BAN_MANAGER_ABI,
      functionName: 'getAddressBan',
      args: [address],
    }),
  ]);

  const entry: BanCacheEntry = {
    isBanned: isBanned as boolean,
    isOnNotice: isOnNotice as boolean,
    reason: (banRecord as { reason: string }).reason || '',
    caseId: (banRecord as { caseId: Hex }).caseId || null,
    timestamp: Date.now(),
  };

  banCache.set(cacheKey, entry);
  return entry;
}

// ============ Middleware ============

/**
 * Express middleware that blocks banned users
 */
export function banCheck(options: BanCheckOptions = {}) {
  const {
    failClosed = true,
    cacheTtlMs = DEFAULT_CACHE_TTL,
    skipPaths = ['/health', '/.well-known', '/public'],
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Skip certain paths
    if (skipPaths.some(path => req.path.startsWith(path))) {
      return next();
    }

    // Extract address from various sources
    const address = (
      req.headers['x-wallet-address'] ||
      req.body?.address ||
      req.body?.from ||
      req.body?.sender ||
      req.query?.address
    ) as Address | undefined;

    // No address to check - allow through
    if (!address) {
      return next();
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return next();
    }

    try {
      const banStatus = await checkBan(address, cacheTtlMs);

      if (banStatus.isBanned || banStatus.isOnNotice) {
        res.status(403).json({
          error: 'BANNED',
          message: banStatus.reason || 'User is banned from network services',
          isOnNotice: banStatus.isOnNotice,
          caseId: banStatus.caseId,
          appealUrl: banStatus.caseId 
            ? `/moderation/case/${banStatus.caseId}/appeal` 
            : undefined,
        });
        return;
      }

      next();
    } catch (error) {
      console.error('Ban check error:', error);
      
      // Fail-closed: block on error
      if (failClosed) {
        res.status(503).json({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Unable to verify user status. Please try again.',
        });
        return;
      }
      
      // Fail-open: allow through on error (less secure)
      next();
    }
  };
}

/**
 * Strict ban check that blocks on-notice users as well
 */
export function strictBanCheck() {
  return banCheck({ failClosed: true });
}

/**
 * Lenient ban check that allows on-notice users
 */
export function lenientBanCheck() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const address = (
      req.headers['x-wallet-address'] ||
      req.body?.address ||
      req.body?.from
    ) as Address | undefined;

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return next();
    }

    try {
      const banStatus = await checkBan(address, DEFAULT_CACHE_TTL);

      // Only block permanently banned users, allow on-notice
      if (banStatus.isBanned && !banStatus.isOnNotice) {
        res.status(403).json({
          error: 'BANNED',
          message: banStatus.reason || 'User is banned',
          caseId: banStatus.caseId,
        });
        return;
      }

      // Add header if on notice
      if (banStatus.isOnNotice) {
        res.setHeader('X-Moderation-Status', 'ON_NOTICE');
        res.setHeader('X-Moderation-Case', banStatus.caseId || 'unknown');
      }

      next();
    } catch {
      // Fail-open for lenient check
      next();
    }
  };
}

/**
 * Clear ban cache for an address
 */
export function clearBanCache(address?: Address): void {
  if (address) {
    banCache.delete(address.toLowerCase());
  } else {
    banCache.clear();
  }
}

/**
 * Export for direct use in services
 */
export { checkBan, BAN_MANAGER_ADDRESS, MODERATION_MARKETPLACE_ADDRESS };


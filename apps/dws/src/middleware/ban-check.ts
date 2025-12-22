/**
 * Ban Check Middleware for DWS
 * Uses @jejunetwork/shared for ban checking
 */

import type { Context, Next } from 'hono';
import type { Address } from 'viem';
import {
  BanChecker,
  type BanCheckConfig,
  type BanCheckResult,
} from '@jejunetwork/shared';

// Get config from environment
const BAN_MANAGER_ADDRESS = process.env.BAN_MANAGER_ADDRESS as Address | undefined;
const MODERATION_MARKETPLACE_ADDRESS = process.env.MODERATION_MARKETPLACE_ADDRESS as Address | undefined;
const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';
const NETWORK = (process.env.NETWORK || 'localnet') as 'mainnet' | 'testnet' | 'localnet';

// Skip paths that don't need ban checking (public endpoints)
const SKIP_PATHS = [
  '/health',
  '/info',
  '/metrics',
  '/.well-known',
  '/storage/ipfs', // Public IPFS gateway reads
  '/cdn', // Public CDN reads
];

// Create checker only if ban manager is configured
let checker: BanChecker | null = null;

if (BAN_MANAGER_ADDRESS) {
  const config: BanCheckConfig = {
    banManagerAddress: BAN_MANAGER_ADDRESS,
    moderationMarketplaceAddress: MODERATION_MARKETPLACE_ADDRESS,
    rpcUrl: RPC_URL,
    network: NETWORK,
    cacheTtlMs: 30000,
    failClosed: true,
  };
  checker = new BanChecker(config);
}

/**
 * Hono middleware that checks ban status
 */
export function banCheckMiddleware() {
  return async (c: Context, next: Next) => {
    // Skip if no ban manager configured (local dev)
    if (!checker) {
      return next();
    }

    // Skip certain paths
    if (SKIP_PATHS.some(path => c.req.path.startsWith(path))) {
      return next();
    }

    // Skip GET requests on public read paths
    if (c.req.method === 'GET' && c.req.path.startsWith('/storage/')) {
      return next();
    }

    // Extract address from various sources
    let address = c.req.header('x-wallet-address') || c.req.query('address');
    
    if (!address) {
      // Try to get from JSON body for POST/PUT/DELETE
      if (['POST', 'PUT', 'DELETE'].includes(c.req.method)) {
        const contentType = c.req.header('content-type') || '';
        if (contentType.includes('application/json')) {
          const body = await c.req.json().catch(() => ({})) as {
            address?: string;
            from?: string;
            sender?: string;
            owner?: string;
          };
          address = body.address || body.from || body.sender || body.owner;
        }
      }
    }

    // No address to check - allow through
    if (!address) {
      return next();
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return next();
    }

    const result = await checker.checkBan(address as Address);

    if (!result.allowed) {
      return c.json({
        error: 'BANNED',
        message: result.status?.reason || 'User is banned from DWS services',
        banType: result.status?.banType,
        caseId: result.status?.caseId,
        canAppeal: result.status?.canAppeal,
      }, 403);
    }

    return next();
  };
}

/**
 * Check ban status directly
 */
export async function checkBan(address: Address): Promise<BanCheckResult | null> {
  if (!checker) return null;
  return checker.checkBan(address);
}

/**
 * Clear ban cache
 */
export function clearBanCache(address?: Address): void {
  checker?.clearCache(address);
}

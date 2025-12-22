/**
 * Ban Check Middleware for Gateway
 * Re-exports from @jejunetwork/shared with gateway-specific configuration
 */

import type { Request, Response, NextFunction } from 'express';
import type { Address } from 'viem';
import {
  BanChecker,
  createExpressBanMiddleware,
  type BanCheckConfig,
  type BanCheckResult,
} from '@jejunetwork/shared';
import { BAN_MANAGER_ADDRESS, MODERATION_MARKETPLACE_ADDRESS } from '../config/contracts.js';
import { getRpcUrl } from '../config/networks.js';
import { BAN_MANAGER_ABI } from '@jejunetwork/types';

// Gateway ban check configuration
const gatewayBanConfig: BanCheckConfig = {
  banManagerAddress: BAN_MANAGER_ADDRESS,
  moderationMarketplaceAddress: MODERATION_MARKETPLACE_ADDRESS,
  rpcUrl: getRpcUrl(84532),
  network: 'testnet',
  cacheTtlMs: 30000, // 30 seconds
  failClosed: true,
};

// Create singleton checker
const checker = new BanChecker(gatewayBanConfig);

// Re-export types and config
export type { BanCheckConfig, BanCheckResult };
export { BAN_MANAGER_ADDRESS, MODERATION_MARKETPLACE_ADDRESS };

/**
 * Express middleware that blocks banned users
 */
export function banCheck(options: { skipPaths?: string[] } = {}) {
  const { skipPaths = ['/health', '/.well-known', '/public'] } = options;
  const middleware = createExpressBanMiddleware(gatewayBanConfig);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Skip certain paths
    if (skipPaths.some(path => req.path.startsWith(path))) {
      return next();
    }
    
    return middleware(req as Parameters<typeof middleware>[0], res as Parameters<typeof middleware>[1], next);
  };
}

/**
 * Strict ban check that blocks on-notice users
 */
export function strictBanCheck() {
  return banCheck({});
}

/**
 * Lenient ban check that allows on-notice users through (with warning header)
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

    const result = await checker.checkBan(address);

    // Only block permanently banned (not on-notice)
    if (!result.allowed && result.status && !result.status.isOnNotice) {
      res.status(403).json({
        error: 'BANNED',
        message: result.status.reason || 'User is banned',
        caseId: result.status.caseId,
      });
      return;
    }

    // Add header if on notice
    if (result.status?.isOnNotice) {
      res.setHeader('X-Moderation-Status', 'ON_NOTICE');
      res.setHeader('X-Moderation-Case', result.status.caseId || 'unknown');
    }

    next();
  };
}

/**
 * Check ban status for an address
 */
export async function checkBan(address: Address): Promise<BanCheckResult> {
  return checker.checkBan(address);
}

/**
 * Clear ban cache
 */
export function clearBanCache(address?: Address): void {
  checker.clearCache(address);
}

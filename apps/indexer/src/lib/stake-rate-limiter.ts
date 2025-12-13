import { ethers } from 'ethers';
import type { Request, Response, NextFunction } from 'express';
import { loadNetworkConfig } from '../network-config';

export const RATE_LIMITS = { BANNED: 0, FREE: 100, BASIC: 1000, PRO: 10000, UNLIMITED: 0 } as const;
export type RateTier = keyof typeof RATE_LIMITS;

const TIER_THRESHOLDS = { BASIC: 10, PRO: 100, UNLIMITED: 1000 }; // USD thresholds
const CACHE_TTL = 60_000;
const WINDOW_MS = 60_000;
const ETH_USD_PRICE = Number(process.env.ETH_USD_PRICE) || 2000;

const rateLimitStore = new Map<string, { count: number; resetAt: number; tier: RateTier }>();
const stakeCache = new Map<string, { tier: RateTier; expiresAt: number }>();

const IDENTITY_ABI = ['function getAgentId(address) view returns (uint256)'] as const;
const BAN_ABI = ['function isBanned(uint256) view returns (bool)'] as const;
const STAKING_ABI = [
  'function getStake(address) view returns (uint256)',
  'function positions(address) view returns (uint256,uint256,uint256)',
] as const;

let contracts: {
  provider: ethers.JsonRpcProvider;
  identity: ethers.Contract | null;
  ban: ethers.Contract | null;
  staking: ethers.Contract | null;
} | null = null;

function getContracts() {
  if (contracts) return contracts;
  
  const config = loadNetworkConfig();
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const { identityRegistry, banManager, nodeStakingManager } = config.contracts;
  const stakingAddr = process.env.INDEXER_STAKING_ADDRESS || nodeStakingManager;
  
  contracts = {
    provider,
    identity: identityRegistry ? new ethers.Contract(identityRegistry, IDENTITY_ABI, provider) : null,
    ban: banManager ? new ethers.Contract(banManager, BAN_ABI, provider) : null,
    staking: stakingAddr ? new ethers.Contract(stakingAddr, STAKING_ABI, provider) : null,
  };
  return contracts;
}

async function getStakeTier(address: string): Promise<RateTier> {
  const key = address.toLowerCase();
  const cached = stakeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.tier;

  const { identity, ban, staking } = getContracts();
  let tier: RateTier = 'FREE';

  if (identity && ban) {
    const agentId = await identity.getAgentId(address);
    if (agentId > 0n) {
      if (await ban.isBanned(agentId)) {
        tier = 'BANNED';
        stakeCache.set(key, { tier, expiresAt: Date.now() + CACHE_TTL });
        return tier;
      }
    }
  }

  if (staking) {
    const stakeWei = await staking.getStake(address);
    const stakeUsd = (Number(stakeWei) / 1e18) * ETH_USD_PRICE;
    tier = stakeUsd >= TIER_THRESHOLDS.UNLIMITED ? 'UNLIMITED'
         : stakeUsd >= TIER_THRESHOLDS.PRO ? 'PRO'
         : stakeUsd >= TIER_THRESHOLDS.BASIC ? 'BASIC'
         : 'FREE';
  }

  stakeCache.set(key, { tier, expiresAt: Date.now() + CACHE_TTL });
  return tier;
}

function getClientKey(req: Request): { key: string; address: string | null } {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (apiKey) return { key: `apikey:${apiKey}`, address: null };

  const walletAddr = req.headers['x-wallet-address'] as string | undefined;
  if (walletAddr && ethers.isAddress(walletAddr)) {
    return { key: `addr:${walletAddr.toLowerCase()}`, address: walletAddr };
  }

  const agentId = req.headers['x-agent-id'] as string | undefined;
  if (agentId) return { key: `agent:${agentId}`, address: null };

  const forwarded = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim();
  const ip = forwarded || (req.headers['x-real-ip'] as string) || req.ip;
  if (!ip) throw new Error('Unable to determine client IP address');
  return { key: `ip:${ip}`, address: null };
}

// Cleanup expired entries (runs once per minute)
setInterval(() => {
  const now = Date.now();
  for (const [key, { resetAt }] of rateLimitStore) {
    if (now > resetAt) rateLimitStore.delete(key);
  }
}, 60_000).unref(); // unref() prevents this from keeping the process alive

export interface RateLimitOptions {
  skipPaths?: string[];
  tierOverride?: RateTier;
}

export function stakeRateLimiter(options: RateLimitOptions = {}) {
  const skipPaths = options.skipPaths || ['/health', '/.well-known'];

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (skipPaths.some(p => req.path.startsWith(p))) return next();

    const { key, address } = getClientKey(req);
    const now = Date.now();
    const tier = options.tierOverride || (address ? await getStakeTier(address) : 'FREE');

    if (tier === 'BANNED') {
      res.status(403).json({ error: 'Access denied', message: 'Address banned from network' });
      return;
    }

    let record = rateLimitStore.get(key);
    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + WINDOW_MS, tier };
      rateLimitStore.set(key, record);
    }
    record.count++;

    const limit = RATE_LIMITS[tier];
    const remaining = limit === 0 ? -1 : Math.max(0, limit - record.count);

    res.setHeader('X-RateLimit-Limit', limit === 0 ? 'unlimited' : String(limit));
    res.setHeader('X-RateLimit-Remaining', remaining === -1 ? 'unlimited' : String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(record.resetAt / 1000)));
    res.setHeader('X-RateLimit-Tier', tier);

    if (limit > 0 && record.count > limit) {
      res.status(429).json({
        error: 'Rate limit exceeded', tier, limit, resetAt: record.resetAt,
        upgrade: 'Stake tokens to increase your rate limit',
      });
      return;
    }

    (req as Request & { rateLimitTier: RateTier }).rateLimitTier = tier;
    next();
  };
}

export function getRateLimitStats() {
  const byTier: Record<RateTier, number> = { BANNED: 0, FREE: 0, BASIC: 0, PRO: 0, UNLIMITED: 0 };
  for (const { tier } of rateLimitStore.values()) byTier[tier]++;
  return { totalTracked: rateLimitStore.size, byTier };
}

export { getStakeTier, stakeCache, rateLimitStore };

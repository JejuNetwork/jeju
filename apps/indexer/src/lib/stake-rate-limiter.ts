import { createPublicClient, http, parseAbi, isAddress, type Address, type PublicClient, type Chain, type Transport } from 'viem';
import type { Request, Response, NextFunction } from 'express';
import { loadNetworkConfig } from '../network-config';
import { inferChainFromRpcUrl } from './chain-utils';
import { addressSchema, validateOrThrow } from './validation';

type ViemPublicClient = PublicClient<Transport, Chain>;

async function readContract<T>(client: ViemPublicClient, params: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }): Promise<T> {
  return client.readContract(params) as Promise<T>;
}

export const RATE_LIMITS = { BANNED: 0, FREE: 100, BASIC: 1000, PRO: 10000, UNLIMITED: 0 } as const;
export type RateTier = keyof typeof RATE_LIMITS;

const TIER_THRESHOLDS = { BASIC: 10, PRO: 100, UNLIMITED: 1000 }; // USD thresholds
const CACHE_TTL = 60_000;
const WINDOW_MS = 60_000;
const ETH_USD_PRICE = Number(process.env.ETH_USD_PRICE) || 2000;

const rateLimitStore = new Map<string, { count: number; resetAt: number; tier: RateTier }>();
const stakeCache = new Map<string, { tier: RateTier; expiresAt: number }>();

const IDENTITY_ABI = parseAbi(['function getAgentId(address) view returns (uint256)']);
const BAN_ABI = parseAbi(['function isBanned(uint256) view returns (bool)']);
const STAKING_ABI = parseAbi([
  'function getStake(address) view returns (uint256)',
  'function positions(address) view returns (uint256,uint256,uint256)',
]);

let contracts: {
  publicClient: ViemPublicClient;
  identityAddress: Address | null;
  banAddress: Address | null;
  stakingAddress: Address | null;
} | null = null;

function getContracts() {
  if (contracts) return contracts;
  
  const config = loadNetworkConfig();
  const chain = inferChainFromRpcUrl(config.rpcUrl);
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const { identityRegistry, banManager, nodeStakingManager } = config.contracts;
  const stakingAddr = process.env.INDEXER_STAKING_ADDRESS || nodeStakingManager;
  
  contracts = {
    publicClient,
    identityAddress: identityRegistry ? (identityRegistry as Address) : null,
    banAddress: banManager ? (banManager as Address) : null,
    stakingAddress: stakingAddr ? (stakingAddr as Address) : null,
  };
  return contracts;
}

async function getStakeTier(address: string): Promise<RateTier> {
  validateOrThrow(addressSchema, address, 'getStakeTier address');
  const key = address.toLowerCase();
  const cached = stakeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.tier;

  const { publicClient, identityAddress, banAddress, stakingAddress } = getContracts();
  let tier: RateTier = 'FREE';

  if (identityAddress && banAddress) {
    const agentId = await readContract<bigint>(publicClient, {
      address: identityAddress,
      abi: IDENTITY_ABI,
      functionName: 'getAgentId',
      args: [address as Address],
    });
    if (agentId > 0n) {
      const isBanned = await readContract<boolean>(publicClient, {
        address: banAddress,
        abi: BAN_ABI,
        functionName: 'isBanned',
        args: [agentId],
      });
      if (isBanned) {
        tier = 'BANNED';
        stakeCache.set(key, { tier, expiresAt: Date.now() + CACHE_TTL });
        return tier;
      }
    }
  }

  if (stakingAddress) {
    const stakeWei = await readContract<bigint>(publicClient, {
      address: stakingAddress,
      abi: STAKING_ABI,
      functionName: 'getStake',
      args: [address as Address],
    });
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
  if (walletAddr && isAddress(walletAddr)) {
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

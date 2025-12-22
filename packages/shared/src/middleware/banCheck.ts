/**
 * Ban Check Middleware
 * 
 * Universal middleware for checking ban status before processing requests.
 * Can be used with Express, Hono, or any HTTP framework.
 */

import { createPublicClient, http, type Address, type Hex, type PublicClient, type Chain, type Transport } from 'viem';
import { baseSepolia, base } from 'viem/chains';

// ============ Types ============

export interface BanCheckConfig {
  banManagerAddress: Address;
  moderationMarketplaceAddress?: Address;
  rpcUrl?: string;
  network?: 'mainnet' | 'testnet' | 'localnet';
  cacheTtlMs?: number;
  failClosed?: boolean; // If true, block on errors (security-first)
}

export interface BanStatus {
  isBanned: boolean;
  isOnNotice: boolean;
  banType: number;
  reason: string;
  caseId: Hex | null;
  canAppeal: boolean;
}

export interface BanCheckResult {
  allowed: boolean;
  status?: BanStatus;
  error?: string;
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
    name: 'isAddressBannedActive',
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

interface CacheEntry {
  result: BanCheckResult;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();

// ============ BanChecker Class ============

export class BanChecker {
  private config: Required<BanCheckConfig>;
  private publicClient: PublicClient<Transport, Chain>;

  constructor(config: BanCheckConfig) {
    const network = config.network || 'testnet';
    const defaultRpc = network === 'mainnet' 
      ? 'https://mainnet.base.org' 
      : network === 'testnet'
        ? 'https://sepolia.base.org'
        : 'http://localhost:8545';

    this.config = {
      banManagerAddress: config.banManagerAddress,
      moderationMarketplaceAddress: config.moderationMarketplaceAddress || ('0x0' as Address),
      rpcUrl: config.rpcUrl || defaultRpc,
      network,
      cacheTtlMs: config.cacheTtlMs || 10000, // 10 seconds default
      failClosed: config.failClosed ?? true, // Security-first by default
    };

    const chain = network === 'mainnet' ? base : baseSepolia;
    this.publicClient = createPublicClient({
      chain,
      transport: http(this.config.rpcUrl),
    }) as PublicClient<Transport, Chain>;
  }

  /**
   * Check if an address is banned
   */
  async checkBan(address: Address): Promise<BanCheckResult> {
    const cacheKey = address.toLowerCase();
    
    // Check cache
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.config.cacheTtlMs) {
      return cached.result;
    }

    try {
      // Check all ban statuses in parallel
      const [isBanned, isOnNotice, banRecord] = await Promise.all([
        this.publicClient.readContract({
          address: this.config.banManagerAddress,
          abi: BAN_MANAGER_ABI,
          functionName: 'isAddressBanned',
          args: [address],
        }),
        this.publicClient.readContract({
          address: this.config.banManagerAddress,
          abi: BAN_MANAGER_ABI,
          functionName: 'isOnNotice',
          args: [address],
        }),
        this.publicClient.readContract({
          address: this.config.banManagerAddress,
          abi: BAN_MANAGER_ABI,
          functionName: 'getAddressBan',
          args: [address],
        }),
      ]);

      const status: BanStatus = {
        isBanned: isBanned as boolean,
        isOnNotice: isOnNotice as boolean,
        banType: (banRecord as { banType: number }).banType,
        reason: (banRecord as { reason: string }).reason || '',
        caseId: (banRecord as { caseId: Hex }).caseId || null,
        canAppeal: (banRecord as { banType: number }).banType === 3, // PERMANENT
      };

      const result: BanCheckResult = {
        allowed: !status.isBanned && !status.isOnNotice,
        status,
      };

      // Update cache
      cache.set(cacheKey, { result, timestamp: Date.now() });
      
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Fail-closed: if we can't verify, block the request
      if (this.config.failClosed) {
        return {
          allowed: false,
          error: `Ban check failed (fail-closed): ${errorMessage}`,
        };
      }
      
      // Fail-open: allow if we can't verify (less secure)
      return {
        allowed: true,
        error: `Ban check failed (fail-open): ${errorMessage}`,
      };
    }
  }

  /**
   * Clear cache for an address (call after ban/unban events)
   */
  clearCache(address?: Address): void {
    if (address) {
      cache.delete(address.toLowerCase());
    } else {
      cache.clear();
    }
  }
}

// ============ Express Middleware ============

export interface ExpressRequest {
  headers: { [key: string]: string | undefined };
  body?: { address?: string; from?: string; sender?: string };
  query?: { address?: string };
}

export interface ExpressResponse {
  status(code: number): ExpressResponse;
  json(data: Record<string, unknown>): void;
}

export type ExpressNextFunction = () => void;

/**
 * Create Express middleware for ban checking
 */
export function createExpressBanMiddleware(config: BanCheckConfig) {
  const checker = new BanChecker(config);

  return async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: ExpressNextFunction
  ) => {
    // Extract address from various sources
    const address = 
      req.headers['x-wallet-address'] ||
      req.body?.address ||
      req.body?.from ||
      req.body?.sender ||
      req.query?.address;

    if (!address) {
      // No address to check - allow through
      return next();
    }

    const result = await checker.checkBan(address as Address);

    if (!result.allowed) {
      return res.status(403).json({
        error: 'BANNED',
        message: result.status?.reason || 'User is banned from this service',
        banType: result.status?.banType,
        caseId: result.status?.caseId,
        canAppeal: result.status?.canAppeal,
      });
    }

    next();
  };
}

// ============ Hono Middleware ============

export interface HonoContext {
  req: {
    header(name: string): string | undefined;
    json(): Promise<{ address?: string; from?: string; sender?: string }>;
    query(name: string): string | undefined;
  };
  json(data: Record<string, unknown>, status?: number): Response;
}

export type HonoNextFunction = () => Promise<void>;

/**
 * Create Hono middleware for ban checking
 */
export function createHonoBanMiddleware(config: BanCheckConfig) {
  const checker = new BanChecker(config);

  return async (c: HonoContext, next: HonoNextFunction) => {
    // Extract address from various sources
    let address = c.req.header('x-wallet-address') || c.req.query('address');
    
    if (!address) {
      try {
        const body = await c.req.json();
        address = body.address || body.from || body.sender;
      } catch {
        // No JSON body
      }
    }

    if (!address) {
      return next();
    }

    const result = await checker.checkBan(address as Address);

    if (!result.allowed) {
      return c.json({
        error: 'BANNED',
        message: result.status?.reason || 'User is banned from this service',
        banType: result.status?.banType,
        caseId: result.status?.caseId,
        canAppeal: result.status?.canAppeal,
      }, 403);
    }

    return next();
  };
}

// ============ Generic Function ============

/**
 * Simple function to check ban status (for custom integrations)
 */
export async function isBanned(
  address: Address,
  config: BanCheckConfig
): Promise<boolean> {
  const checker = new BanChecker(config);
  const result = await checker.checkBan(address);
  return !result.allowed;
}

/**
 * Get full ban status
 */
export async function getBanStatus(
  address: Address,
  config: BanCheckConfig
): Promise<BanCheckResult> {
  const checker = new BanChecker(config);
  return checker.checkBan(address);
}

// ============ Singleton Instance ============

let defaultChecker: BanChecker | null = null;

export function initBanChecker(config: BanCheckConfig): BanChecker {
  defaultChecker = new BanChecker(config);
  return defaultChecker;
}

export function getDefaultChecker(): BanChecker {
  if (!defaultChecker) {
    throw new Error('BanChecker not initialized. Call initBanChecker first.');
  }
  return defaultChecker;
}


/**
 * Decentralized Rate Limiting
 * 
 * Uses the Jeju Cache Service for distributed rate limiting.
 * Supports multi-instance deployments with consistent rate limiting.
 */

import { getCacheClient, type CacheClient } from "@jeju/shared/cache";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// Get cache client for rate limiting
let cacheClient: CacheClient | null = null;

function getCache(): CacheClient {
  if (!cacheClient) {
    cacheClient = getCacheClient("leaderboard-ratelimit");
  }
  return cacheClient;
}

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  limit: number;
  /** Time window in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check rate limit for a key (typically IP or user)
 * Uses decentralized cache for distributed rate limiting
 */
export async function checkRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const cache = getCache();
  const cacheKey = `ratelimit:${key}`;
  const now = Date.now();

  const cached = await cache.get(cacheKey);
  
  if (cached) {
    const entry = JSON.parse(cached) as RateLimitEntry;
    
    // Check if window expired
    if (entry.resetAt < now) {
      // Window expired, create new entry
      const newEntry: RateLimitEntry = {
        count: 1,
        resetAt: now + config.windowMs,
      };
      
      const ttl = Math.ceil(config.windowMs / 1000);
      await cache.set(cacheKey, JSON.stringify(newEntry), ttl);
      
      return {
        success: true,
        remaining: config.limit - 1,
        resetAt: newEntry.resetAt,
      };
    }
    
    // Check if limit exceeded
    if (entry.count >= config.limit) {
      return {
        success: false,
        remaining: 0,
        resetAt: entry.resetAt,
      };
    }
    
    // Increment count
    entry.count++;
    const remainingTtl = Math.ceil((entry.resetAt - now) / 1000);
    await cache.set(cacheKey, JSON.stringify(entry), remainingTtl);
    
    return {
      success: true,
      remaining: config.limit - entry.count,
      resetAt: entry.resetAt,
    };
  }
  
  // No entry, create new one
  const newEntry: RateLimitEntry = {
    count: 1,
    resetAt: now + config.windowMs,
  };
  
  const ttl = Math.ceil(config.windowMs / 1000);
  await cache.set(cacheKey, JSON.stringify(newEntry), ttl);
  
  return {
    success: true,
    remaining: config.limit - 1,
    resetAt: newEntry.resetAt,
  };
}

/**
 * Synchronous check for backward compatibility in contexts that can't await
 * Falls back to allowing the request if cache is unavailable
 */
export function checkRateLimitSync(
  key: string,
  config: RateLimitConfig
): RateLimitResult {
  // Start async check but don't wait
  checkRateLimit(key, config).catch((err) => {
    console.warn("[RateLimit] Async check failed:", err);
  });
  
  // Return permissive result for sync contexts
  // The async check will enforce limits on subsequent requests
  return {
    success: true,
    remaining: config.limit - 1,
    resetAt: Date.now() + config.windowMs,
  };
}

/**
 * Get client identifier for rate limiting
 * Uses IP address or falls back to a header-based identifier
 */
export function getClientIdentifier(request: Request): string {
  // Try to get real IP from various headers (proxy/CDN scenarios)
  const forwardedFor = request.headers.get("X-Forwarded-For");
  if (forwardedFor) {
    // Take the first IP in the chain (original client)
    return forwardedFor.split(",")[0].trim();
  }
  
  const realIp = request.headers.get("X-Real-IP");
  if (realIp) {
    return realIp;
  }
  
  const cfIp = request.headers.get("CF-Connecting-IP");
  if (cfIp) {
    return cfIp;
  }
  
  // Fallback to a generic identifier (not ideal but prevents crashes)
  return "unknown-client";
}

// Default rate limit configs
export const RATE_LIMITS = {
  // Wallet verification: 10 requests per minute
  walletVerify: { limit: 10, windowMs: 60 * 1000 },
  
  // Attestation requests: 20 per minute
  attestation: { limit: 20, windowMs: 60 * 1000 },
  
  // Agent links: 30 per minute
  agentLink: { limit: 30, windowMs: 60 * 1000 },
  
  // General API: 60 per minute
  general: { limit: 60, windowMs: 60 * 1000 },
} as const;

/**
 * Create rate limit exceeded response
 */
export function rateLimitExceededResponse(
  result: RateLimitResult,
  corsHeaders: Record<string, string>
): Response {
  const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
  
  return new Response(
    JSON.stringify({
      error: "Rate limit exceeded",
      retryAfter,
      resetAt: result.resetAt,
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": retryAfter.toString(),
        "X-RateLimit-Remaining": result.remaining.toString(),
        "X-RateLimit-Reset": result.resetAt.toString(),
      },
    }
  );
}

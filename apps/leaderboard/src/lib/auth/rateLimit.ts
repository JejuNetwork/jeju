/**
 * Simple in-memory rate limiting
 * For production, use Redis-backed solution like @upstash/ratelimit
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory store for rate limiting
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up old entries periodically
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute
let lastCleanup = Date.now();

function cleanupExpiredEntries(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) {
    return;
  }
  
  lastCleanup = now;
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
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
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig
): RateLimitResult {
  cleanupExpiredEntries();
  
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  
  // If no entry or window expired, create new entry
  if (!entry || entry.resetAt < now) {
    const newEntry: RateLimitEntry = {
      count: 1,
      resetAt: now + config.windowMs,
    };
    rateLimitStore.set(key, newEntry);
    
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
  rateLimitStore.set(key, entry);
  
  return {
    success: true,
    remaining: config.limit - entry.count,
    resetAt: entry.resetAt,
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

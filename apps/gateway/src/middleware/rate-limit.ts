/**
 * Express Rate Limiter using rate-limiter-flexible
 * Replaces custom implementation with battle-tested library
 */

import type { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory } from 'rate-limiter-flexible';

interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
  keyGenerator?: (req: Request) => string;
  skipPaths?: string[];
  message?: string;
}

const DEFAULT_OPTIONS: Required<RateLimitOptions> = {
  windowMs: 60 * 1000,
  maxRequests: process.env.NODE_ENV === 'test' ? 10000 : 1000,
  keyGenerator: (req) => req.ip || (req.headers['x-forwarded-for'] as string) || 'unknown',
  skipPaths: ['/health', '/.well-known/agent-card.json'],
  message: 'Too many requests, please try again later',
};

export function rateLimit(options: RateLimitOptions = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  
  const limiter = new RateLimiterMemory({
    points: config.maxRequests,
    duration: Math.ceil(config.windowMs / 1000),
  });

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (config.skipPaths.some(path => req.path.startsWith(path))) {
      next();
      return;
    }

    const key = config.keyGenerator(req);

    try {
      const result = await limiter.consume(key);
      
      res.setHeader('X-RateLimit-Limit', config.maxRequests);
      res.setHeader('X-RateLimit-Remaining', result.remainingPoints);
      res.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000) + Math.ceil(result.msBeforeNext / 1000));
      
      next();
    } catch (rejRes) {
      const rateLimiterRes = rejRes as { msBeforeNext: number; remainingPoints: number };
      const retryAfter = Math.ceil(rateLimiterRes.msBeforeNext / 1000);
      
      res.setHeader('X-RateLimit-Limit', config.maxRequests);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000) + retryAfter);
      res.setHeader('Retry-After', retryAfter);
      
      res.status(429).json({
        error: 'Too Many Requests',
        message: config.message,
        retryAfter,
      });
    }
  };
}

export function strictRateLimit() {
  return rateLimit({
    windowMs: 60 * 1000,
    maxRequests: process.env.NODE_ENV === 'test' ? 10000 : 200,
    message: 'Rate limit exceeded for write operations',
  });
}

export function agentRateLimit() {
  return rateLimit({
    windowMs: 60 * 1000,
    maxRequests: process.env.NODE_ENV === 'test' ? 10000 : 500,
    keyGenerator: (req) => (req.headers['x-agent-id'] as string) || req.ip || 'unknown',
  });
}

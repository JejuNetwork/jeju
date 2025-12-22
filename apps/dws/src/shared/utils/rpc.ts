/**
 * RPC service utilities and types
 * Business logic extracted from routes
 */

import type { Address } from 'viem';

export interface RPCProvider {
  id: string;
  operator: Address;
  chainId: number;
  endpoint: string;
  wsEndpoint?: string;
  region: string;
  tier: 'free' | 'standard' | 'premium';
  maxRps: number;
  currentRps: number;
  latency: number;
  uptime: number;
  lastSeen: number;
  status: 'active' | 'degraded' | 'offline';
}

export interface RPCSession {
  id: string;
  user: Address;
  chainId: number;
  apiKey: string;
  tier: 'free' | 'standard' | 'premium';
  requestCount: number;
  dailyLimit: number;
  createdAt: number;
  expiresAt?: number;
  status: 'active' | 'suspended' | 'expired';
}

/**
 * Find best available RPC provider for a chain
 */
export function findBestProvider(
  providers: Map<string, RPCProvider>,
  chainId: number
): RPCProvider | null {
  const availableProviders = Array.from(providers.values())
    .filter(p => 
      p.chainId === chainId && 
      p.status === 'active' &&
      p.currentRps < p.maxRps
    )
    .sort((a, b) => a.latency - b.latency);

  return availableProviders[0] || null;
}

/**
 * Validate and get RPC session from API key
 */
export function getSessionFromApiKey(
  apiKey: string | undefined,
  apiKeyToSession: Map<string, string>,
  sessions: Map<string, RPCSession>
): RPCSession | undefined {
  if (!apiKey) return undefined;
  
  const sessionId = apiKeyToSession.get(apiKey);
  if (!sessionId) return undefined;
  
  return sessions.get(sessionId);
}

/**
 * Check if session can make request (rate limits, status)
 */
export function canMakeRequest(session: RPCSession | undefined): { allowed: boolean; reason?: string } {
  if (!session) return { allowed: true }; // No session = public access
  
  if (session.status !== 'active') {
    return { allowed: false, reason: 'API key suspended' };
  }
  
  if (session.requestCount >= session.dailyLimit) {
    return { allowed: false, reason: 'Daily limit exceeded' };
  }
  
  return { allowed: true };
}

/**
 * Extract API key from request headers/query
 */
export function extractApiKey(
  apiKeyHeader: string | undefined,
  authHeader: string | undefined,
  queryApiKey: string | undefined
): string | undefined {
  return apiKeyHeader ?? 
         authHeader?.replace('Bearer ', '') ??
         queryApiKey;
}

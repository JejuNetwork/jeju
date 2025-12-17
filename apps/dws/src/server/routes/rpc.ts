/**
 * RPC Service Routes
 * Multi-chain RPC provider service
 */

import { Hono } from 'hono';
import type { Address } from 'viem';

interface ChainConfig {
  id: number;
  name: string;
  network: string;
  symbol: string;
  rpcUrls: string[];
  wsUrls?: string[];
  explorerUrl?: string;
  isTestnet: boolean;
  enabled: boolean;
}

interface RPCProvider {
  id: string;
  operator: Address;
  chainId: number;
  endpoint: string;
  wsEndpoint?: string;
  region: string;
  tier: 'free' | 'standard' | 'premium';
  maxRps: number;           // requests per second
  currentRps: number;
  latency: number;          // avg ms
  uptime: number;           // percentage
  lastSeen: number;
  status: 'active' | 'degraded' | 'offline';
}

interface RPCSession {
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

// Supported chains
const CHAINS: Record<number, ChainConfig> = {
  // Ethereum
  1: {
    id: 1,
    name: 'Ethereum',
    network: 'mainnet',
    symbol: 'ETH',
    rpcUrls: [],
    explorerUrl: 'https://etherscan.io',
    isTestnet: false,
    enabled: true,
  },
  11155111: {
    id: 11155111,
    name: 'Sepolia',
    network: 'sepolia',
    symbol: 'ETH',
    rpcUrls: [],
    explorerUrl: 'https://sepolia.etherscan.io',
    isTestnet: true,
    enabled: true,
  },
  // Base
  8453: {
    id: 8453,
    name: 'Base',
    network: 'base',
    symbol: 'ETH',
    rpcUrls: [],
    explorerUrl: 'https://basescan.org',
    isTestnet: false,
    enabled: true,
  },
  84532: {
    id: 84532,
    name: 'Base Sepolia',
    network: 'base-sepolia',
    symbol: 'ETH',
    rpcUrls: [],
    explorerUrl: 'https://sepolia.basescan.org',
    isTestnet: true,
    enabled: true,
  },
  // Optimism
  10: {
    id: 10,
    name: 'Optimism',
    network: 'optimism',
    symbol: 'ETH',
    rpcUrls: [],
    explorerUrl: 'https://optimistic.etherscan.io',
    isTestnet: false,
    enabled: true,
  },
  // Arbitrum
  42161: {
    id: 42161,
    name: 'Arbitrum One',
    network: 'arbitrum',
    symbol: 'ETH',
    rpcUrls: [],
    explorerUrl: 'https://arbiscan.io',
    isTestnet: false,
    enabled: true,
  },
  // BSC
  56: {
    id: 56,
    name: 'BNB Smart Chain',
    network: 'bsc',
    symbol: 'BNB',
    rpcUrls: [],
    explorerUrl: 'https://bscscan.com',
    isTestnet: false,
    enabled: true,
  },
  // Polygon
  137: {
    id: 137,
    name: 'Polygon',
    network: 'polygon',
    symbol: 'MATIC',
    rpcUrls: [],
    explorerUrl: 'https://polygonscan.com',
    isTestnet: false,
    enabled: true,
  },
  // Solana (using chain ID convention)
  101: {
    id: 101,
    name: 'Solana',
    network: 'solana-mainnet',
    symbol: 'SOL',
    rpcUrls: [],
    explorerUrl: 'https://explorer.solana.com',
    isTestnet: false,
    enabled: true,
  },
  102: {
    id: 102,
    name: 'Solana Devnet',
    network: 'solana-devnet',
    symbol: 'SOL',
    rpcUrls: [],
    explorerUrl: 'https://explorer.solana.com?cluster=devnet',
    isTestnet: true,
    enabled: true,
  },
};

const providers = new Map<string, RPCProvider>();
const sessions = new Map<string, RPCSession>();
const apiKeyToSession = new Map<string, string>();

// Rate limits by tier
const RATE_LIMITS = {
  free: { rps: 10, daily: 10000 },
  standard: { rps: 100, daily: 1000000 },
  premium: { rps: 1000, daily: 10000000 },
};

export function createRPCRouter(): Hono {
  const router = new Hono();

  // ============================================================================
  // Health & Info
  // ============================================================================

  router.get('/health', (c) => {
    const activeProviders = Array.from(providers.values())
      .filter(p => p.status === 'active');
    
    const chainStatus = Object.values(CHAINS)
      .filter(chain => chain.enabled)
      .map(chain => {
        const chainProviders = activeProviders.filter(p => p.chainId === chain.id);
        return {
          chainId: chain.id,
          name: chain.name,
          providers: chainProviders.length,
          avgLatency: chainProviders.length > 0
            ? chainProviders.reduce((sum, p) => sum + p.latency, 0) / chainProviders.length
            : null,
        };
      });

    return c.json({
      status: 'healthy',
      service: 'dws-rpc',
      chains: chainStatus,
      totalProviders: providers.size,
      activeSessions: sessions.size,
    });
  });

  // List supported chains
  router.get('/chains', (c) => {
    const includeTestnets = c.req.query('testnet') === 'true';
    
    const chains = Object.values(CHAINS)
      .filter(chain => chain.enabled && (includeTestnets || !chain.isTestnet))
      .map(chain => {
        const chainProviders = Array.from(providers.values())
          .filter(p => p.chainId === chain.id && p.status === 'active');
        
        return {
          chainId: chain.id,
          name: chain.name,
          network: chain.network,
          symbol: chain.symbol,
          explorerUrl: chain.explorerUrl,
          isTestnet: chain.isTestnet,
          providers: chainProviders.length,
          avgLatency: chainProviders.length > 0
            ? Math.round(chainProviders.reduce((sum, p) => sum + p.latency, 0) / chainProviders.length)
            : null,
        };
      });

    return c.json({ chains });
  });

  // Get chain info
  router.get('/chains/:chainId', (c) => {
    const chainId = parseInt(c.req.param('chainId'));
    const chain = CHAINS[chainId];
    
    if (!chain || !chain.enabled) {
      return c.json({ error: 'Chain not supported' }, 404);
    }

    const chainProviders = Array.from(providers.values())
      .filter(p => p.chainId === chainId);

    return c.json({
      ...chain,
      providers: chainProviders.map(p => ({
        id: p.id,
        region: p.region,
        tier: p.tier,
        latency: p.latency,
        uptime: p.uptime,
        status: p.status,
      })),
    });
  });

  // ============================================================================
  // Provider Management
  // ============================================================================

  // Register provider
  router.post('/providers', async (c) => {
    const operator = c.req.header('x-jeju-address') as Address;
    if (!operator) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const body = await c.req.json<{
      chainId: number;
      endpoint: string;
      wsEndpoint?: string;
      region: string;
      tier: 'free' | 'standard' | 'premium';
      maxRps: number;
    }>();

    if (!CHAINS[body.chainId]) {
      return c.json({ error: 'Chain not supported' }, 400);
    }

    const id = crypto.randomUUID();
    const provider: RPCProvider = {
      id,
      operator,
      chainId: body.chainId,
      endpoint: body.endpoint,
      wsEndpoint: body.wsEndpoint,
      region: body.region,
      tier: body.tier,
      maxRps: body.maxRps,
      currentRps: 0,
      latency: 0,
      uptime: 100,
      lastSeen: Date.now(),
      status: 'active',
    };

    providers.set(id, provider);

    return c.json({
      providerId: id,
      chainId: body.chainId,
      status: 'registered',
    }, 201);
  });

  // Provider heartbeat
  router.post('/providers/:id/heartbeat', async (c) => {
    const provider = providers.get(c.req.param('id'));
    if (!provider) {
      return c.json({ error: 'Provider not found' }, 404);
    }

    const body = await c.req.json<{
      latency?: number;
      currentRps?: number;
      status?: 'active' | 'degraded' | 'offline';
    }>();

    provider.lastSeen = Date.now();
    if (body.latency !== undefined) provider.latency = body.latency;
    if (body.currentRps !== undefined) provider.currentRps = body.currentRps;
    if (body.status) provider.status = body.status;

    return c.json({ success: true });
  });

  // ============================================================================
  // API Key Management
  // ============================================================================

  // Create API key
  router.post('/keys', async (c) => {
    const user = c.req.header('x-jeju-address') as Address;
    if (!user) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const body = await c.req.json<{
      tier?: 'free' | 'standard' | 'premium';
      chains?: number[];
    }>();

    const tier = body.tier ?? 'free';
    const apiKey = `dws_${crypto.randomUUID().replace(/-/g, '')}`;
    const sessionId = crypto.randomUUID();

    const session: RPCSession = {
      id: sessionId,
      user,
      chainId: 0, // All chains
      apiKey,
      tier,
      requestCount: 0,
      dailyLimit: RATE_LIMITS[tier].daily,
      createdAt: Date.now(),
      status: 'active',
    };

    sessions.set(sessionId, session);
    apiKeyToSession.set(apiKey, sessionId);

    return c.json({
      apiKey,
      tier,
      limits: RATE_LIMITS[tier],
      endpoints: Object.values(CHAINS)
        .filter(chain => chain.enabled)
        .map(chain => ({
          chainId: chain.id,
          name: chain.name,
          http: `/rpc/${chain.id}`,
          ws: `/rpc/${chain.id}/ws`,
        })),
    }, 201);
  });

  // Get API key info
  router.get('/keys/:apiKey', (c) => {
    const sessionId = apiKeyToSession.get(c.req.param('apiKey'));
    if (!sessionId) {
      return c.json({ error: 'API key not found' }, 404);
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }

    return c.json({
      tier: session.tier,
      requestCount: session.requestCount,
      dailyLimit: session.dailyLimit,
      remainingToday: session.dailyLimit - session.requestCount,
      status: session.status,
      createdAt: session.createdAt,
    });
  });

  // Revoke API key
  router.delete('/keys/:apiKey', (c) => {
    const user = c.req.header('x-jeju-address')?.toLowerCase();
    const sessionId = apiKeyToSession.get(c.req.param('apiKey'));
    
    if (!sessionId) {
      return c.json({ error: 'API key not found' }, 404);
    }

    const session = sessions.get(sessionId);
    if (!session || session.user.toLowerCase() !== user) {
      return c.json({ error: 'Not authorized' }, 403);
    }

    session.status = 'suspended';
    apiKeyToSession.delete(c.req.param('apiKey'));

    return c.json({ success: true });
  });

  // ============================================================================
  // RPC Proxy
  // ============================================================================

  // JSON-RPC endpoint
  router.post('/:chainId', async (c) => {
    const chainId = parseInt(c.req.param('chainId'));
    const chain = CHAINS[chainId];
    
    if (!chain || !chain.enabled) {
      return c.json({ error: 'Chain not supported' }, 404);
    }

    // Get API key from header or query
    const apiKey = c.req.header('x-api-key') ?? 
                   c.req.header('authorization')?.replace('Bearer ', '') ??
                   c.req.query('apiKey');

    // Validate API key
    let session: RPCSession | undefined;
    if (apiKey) {
      const sessionId = apiKeyToSession.get(apiKey);
      if (sessionId) {
        session = sessions.get(sessionId);
      }
    }

    // Check rate limits
    if (session) {
      if (session.status !== 'active') {
        return c.json({ error: 'API key suspended' }, 403);
      }
      if (session.requestCount >= session.dailyLimit) {
        return c.json({ error: 'Daily limit exceeded' }, 429);
      }
      session.requestCount++;
    }

    // Find best provider
    const availableProviders = Array.from(providers.values())
      .filter(p => 
        p.chainId === chainId && 
        p.status === 'active' &&
        p.currentRps < p.maxRps
      )
      .sort((a, b) => a.latency - b.latency);

    const provider = availableProviders[0];
    if (!provider) {
      return c.json({ error: 'No available providers' }, 503);
    }

    // Forward request
    try {
      const body = await c.req.json();
      
      const response = await fetch(provider.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const result = await response.json();
      
      // Track provider usage
      provider.currentRps++;
      setTimeout(() => provider.currentRps--, 1000);

      return c.json(result);
    } catch (error) {
      // Mark provider as degraded on error
      provider.status = 'degraded';
      
      return c.json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal error',
        },
        id: null,
      }, 500);
    }
  });

  // Batch RPC
  router.post('/:chainId/batch', async (c) => {
    const chainId = parseInt(c.req.param('chainId'));
    const chain = CHAINS[chainId];
    
    if (!chain || !chain.enabled) {
      return c.json({ error: 'Chain not supported' }, 404);
    }

    const requests = await c.req.json<Array<{
      jsonrpc: string;
      method: string;
      params: unknown[];
      id: number | string;
    }>>();

    if (!Array.isArray(requests)) {
      return c.json({ error: 'Expected array of requests' }, 400);
    }

    // Find provider
    const provider = Array.from(providers.values())
      .find(p => p.chainId === chainId && p.status === 'active');

    if (!provider) {
      return c.json({ error: 'No available providers' }, 503);
    }

    try {
      const response = await fetch(provider.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requests),
      });

      return c.json(await response.json());
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Batch request failed',
      }, 500);
    }
  });

  return router;
}


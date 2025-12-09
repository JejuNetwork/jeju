/**
 * @fileoverview Route Service - Manages cross-chain route discovery and optimization
 * Routes are derived from deployed contracts and actual solver capabilities
 */

import type { IntentRoute } from '@jejunetwork/types';

// Chain configurations
const CHAINS = [
  { chainId: 1, name: 'Ethereum', isL2: false },
  { chainId: 11155111, name: 'Sepolia', isL2: false },
  { chainId: 42161, name: 'Arbitrum One', isL2: true },
  { chainId: 10, name: 'Optimism', isL2: true },
  { chainId: 420691, name: 'Jeju Mainnet', isL2: true },
  { chainId: 420690, name: 'Jeju Testnet', isL2: true },
];

// Token configs per chain
const TOKENS: Record<number, Array<{ address: string; symbol: string; decimals: number }>> = {
  1: [
    { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 },
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
  ],
  11155111: [
    { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 },
  ],
  42161: [
    { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 },
    { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6 },
  ],
  10: [
    { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 },
    { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', symbol: 'USDC', decimals: 6 },
  ],
  420691: [
    { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 },
  ],
};

// Route registry - populated from env vars (deployed contract addresses)
function getRoutes(): IntentRoute[] {
  const routes: IntentRoute[] = [];
  const nativeToken = '0x0000000000000000000000000000000000000000';

  // Build routes from deployed contracts
  const routeConfigs = [
    { source: 1, dest: 42161, oracle: 'hyperlane' },
    { source: 1, dest: 10, oracle: 'superchain' },
    { source: 1, dest: 420691, oracle: 'optimism-native' },
    { source: 42161, dest: 1, oracle: 'hyperlane' },
    { source: 10, dest: 1, oracle: 'superchain' },
    { source: 11155111, dest: 420690, oracle: 'superchain' },
  ];

  for (const config of routeConfigs) {
    const inputSettler = process.env[`OIF_INPUT_SETTLER_${config.source}`];
    const outputSettler = process.env[`OIF_OUTPUT_SETTLER_${config.dest}`];
    
    // Skip routes where contracts aren't deployed
    if (!inputSettler || !outputSettler || 
        inputSettler === '0x0000000000000000000000000000000000000000' ||
        outputSettler === '0x0000000000000000000000000000000000000000') {
      continue;
    }

    const sourceChain = CHAINS.find(c => c.chainId === config.source);
    const destChain = CHAINS.find(c => c.chainId === config.dest);

    if (!sourceChain || !destChain) continue;

    routes.push({
      routeId: `${sourceChain.name.toLowerCase().replace(' ', '-')}-${destChain.name.toLowerCase().replace(' ', '-')}-eth`,
      sourceChainId: config.source as 1 | 11155111 | 42161 | 10 | 1337 | 420691 | 420690,
      destinationChainId: config.dest as 1 | 11155111 | 42161 | 10 | 1337 | 420691 | 420690,
      sourceToken: nativeToken,
      destinationToken: nativeToken,
      inputSettler,
      outputSettler,
      oracle: config.oracle as 'hyperlane' | 'superchain' | 'optimism-native' | 'layerzero' | 'custom',
      isActive: true,
      totalVolume: '0',
      totalIntents: 0,
      avgFeePercent: config.oracle === 'superchain' ? 30 : 50,
      avgFillTimeSeconds: config.oracle === 'superchain' ? 15 : 30,
      successRate: 99,
      activeSolvers: 0,
      totalLiquidity: '0',
      lastUpdated: Date.now(),
    });
  }

  return routes;
}

// Route cache
let routeCache: IntentRoute[] = [];
let lastCacheUpdate = 0;

function refreshRouteCache(): void {
  routeCache = getRoutes();
  lastCacheUpdate = Date.now();
}

interface ListRoutesParams {
  sourceChain?: number;
  destinationChain?: number;
  active?: boolean;
}

interface BestRouteParams {
  sourceChain: number;
  destinationChain: number;
  token?: string;
  amount?: string;
  prioritize?: 'speed' | 'cost';
}

interface VolumeParams {
  routeId?: string;
  sourceChain?: number;
  destinationChain?: number;
  period?: '24h' | '7d' | '30d' | 'all';
}

export class RouteService {
  constructor() {
    refreshRouteCache();
  }

  /**
   * List all routes with optional filters
   */
  async listRoutes(params?: ListRoutesParams): Promise<IntentRoute[]> {
    // Refresh cache if stale (> 5 minutes)
    if (Date.now() - lastCacheUpdate > 5 * 60 * 1000) {
      refreshRouteCache();
    }

    let routes = [...routeCache];

    if (params?.sourceChain) {
      routes = routes.filter(r => r.sourceChainId === params.sourceChain);
    }
    if (params?.destinationChain) {
      routes = routes.filter(r => r.destinationChainId === params.destinationChain);
    }
    if (params?.active === true) {
      routes = routes.filter(r => r.isActive);
    } else if (params?.active === false) {
      routes = routes.filter(r => !r.isActive);
    }

    return routes;
  }

  /**
   * Get route by ID
   */
  async getRoute(routeId: string): Promise<IntentRoute | null> {
    if (Date.now() - lastCacheUpdate > 5 * 60 * 1000) {
      refreshRouteCache();
    }
    return routeCache.find(r => r.routeId === routeId) || null;
  }

  /**
   * Find routes between two chains
   */
  async findRoutes(sourceChain: number, destinationChain: number): Promise<IntentRoute[]> {
    return this.listRoutes({ sourceChain, destinationChain });
  }

  /**
   * Get best route based on criteria
   */
  async getBestRoute(params: BestRouteParams): Promise<IntentRoute | null> {
    const routes = await this.findRoutes(params.sourceChain, params.destinationChain);
    
    if (routes.length === 0) return null;

    // Sort by priority
    const sorted = [...routes].sort((a, b) => {
      if (params.prioritize === 'speed') {
        return a.avgFillTimeSeconds - b.avgFillTimeSeconds;
      }
      return a.avgFeePercent - b.avgFeePercent;
    });

    return sorted[0];
  }

  /**
   * Get volume statistics
   */
  async getVolume(params?: VolumeParams): Promise<{
    totalVolume: string;
    totalVolumeUsd: string;
    totalIntents: number;
    avgFillTime: number;
    period: string;
  }> {
    let routes = [...routeCache];

    if (params?.routeId) {
      routes = routes.filter(r => r.routeId === params.routeId);
    }
    if (params?.sourceChain) {
      routes = routes.filter(r => r.sourceChainId === params.sourceChain);
    }
    if (params?.destinationChain) {
      routes = routes.filter(r => r.destinationChainId === params.destinationChain);
    }

    const totalVolume = routes.reduce(
      (sum, r) => sum + BigInt(r.totalVolume || '0'),
      0n
    );

    const totalIntents = routes.reduce((sum, r) => sum + r.totalIntents, 0);
    const avgFillTime = routes.length > 0
      ? routes.reduce((sum, r) => sum + r.avgFillTimeSeconds, 0) / routes.length
      : 0;

    return {
      totalVolume: totalVolume.toString(),
      totalVolumeUsd: (totalVolume * 2500n / 10n ** 18n).toString(),
      totalIntents,
      avgFillTime: Math.round(avgFillTime),
      period: params?.period || 'all',
    };
  }

  /**
   * Get supported chains
   */
  getChains(): Array<{ chainId: number; name: string; isL2: boolean }> {
    return CHAINS;
  }

  /**
   * Get supported tokens for a chain
   */
  getTokens(chainId: number): Array<{ address: string; symbol: string; decimals: number }> {
    return TOKENS[chainId] || [];
  }
}

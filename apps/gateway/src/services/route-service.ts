import type { IntentRoute, SupportedChainId } from '@jejunetwork/types/oif';
import { INPUT_SETTLER_ADDRESS, OUTPUT_SETTLER_ADDRESS } from '../config/contracts.js';
import { ZERO_ADDRESS } from '../lib/contracts.js';

// Chain configurations
const CHAINS = [
  { chainId: 1, name: 'Ethereum', isL2: false },
  { chainId: 11155111, name: 'Sepolia', isL2: false },
  { chainId: 42161, name: 'Arbitrum One', isL2: true },
  { chainId: 10, name: 'Optimism', isL2: true },
  { chainId: 420691, name: 'Jeju Mainnet', isL2: true },
  { chainId: 420690, name: 'Jeju Testnet', isL2: true },
  { chainId: 1337, name: 'Localnet', isL2: true },
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
  420690: [
    { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 },
  ],
  1337: [
    { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 },
  ],
};

function getRoutes(): IntentRoute[] {
  const routes: IntentRoute[] = [];
  const nativeToken = ZERO_ADDRESS;

  // Only add routes if we have valid settler contracts
  if (INPUT_SETTLER_ADDRESS === ZERO_ADDRESS || OUTPUT_SETTLER_ADDRESS === ZERO_ADDRESS) {
    return routes;
  }

  const routeConfigs = [
    { source: 420690, dest: 11155111, oracle: 'superchain' },
    { source: 11155111, dest: 420690, oracle: 'superchain' },
    { source: 420691, dest: 1, oracle: 'optimism-native' },
    { source: 1, dest: 420691, oracle: 'optimism-native' },
    { source: 420691, dest: 42161, oracle: 'hyperlane' },
    { source: 42161, dest: 420691, oracle: 'hyperlane' },
    { source: 420691, dest: 10, oracle: 'superchain' },
    { source: 10, dest: 420691, oracle: 'superchain' },
  ];

  for (const config of routeConfigs) {
    const sourceChain = CHAINS.find(c => c.chainId === config.source);
    const destChain = CHAINS.find(c => c.chainId === config.dest);

    if (!sourceChain || !destChain) continue;

    routes.push({
      routeId: `${sourceChain.name.toLowerCase().replace(/ /g, '-')}-${destChain.name.toLowerCase().replace(/ /g, '-')}-eth`,
      sourceChainId: config.source as SupportedChainId,
      destinationChainId: config.dest as SupportedChainId,
      sourceToken: nativeToken,
      destinationToken: nativeToken,
      inputSettler: INPUT_SETTLER_ADDRESS,
      outputSettler: OUTPUT_SETTLER_ADDRESS,
      oracle: config.oracle as 'hyperlane' | 'superchain' | 'optimism-native' | 'layerzero' | 'custom',
      isActive: true,
      totalVolume: '0',
      totalIntents: 0,
      avgFeePercent: config.oracle === 'superchain' ? 30 : 50,
      avgFillTimeSeconds: config.oracle === 'superchain' ? 15 : 30,
      successRate: 0,
      activeSolvers: 0,
      totalLiquidity: '0',
      lastUpdated: Date.now(),
    });
  }

  return routes;
}

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
  prioritize?: 'speed' | 'cost';
}

export class RouteService {
  constructor() {
    refreshRouteCache();
  }

  async listRoutes(params?: ListRoutesParams): Promise<IntentRoute[]> {
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

  async getRoute(routeId: string): Promise<IntentRoute | null> {
    if (Date.now() - lastCacheUpdate > 5 * 60 * 1000) {
      refreshRouteCache();
    }
    return routeCache.find(r => r.routeId === routeId) || null;
  }

  async getBestRoute(params: BestRouteParams): Promise<IntentRoute | null> {
    const routes = await this.listRoutes({ 
      sourceChain: params.sourceChain, 
      destinationChain: params.destinationChain 
    });
    
    if (routes.length === 0) return null;

    const sorted = [...routes].sort((a, b) => {
      if (params.prioritize === 'speed') {
        return a.avgFillTimeSeconds - b.avgFillTimeSeconds;
      }
      return a.avgFeePercent - b.avgFeePercent;
    });

    return sorted[0];
  }

  async getVolume(params?: { routeId?: string; sourceChain?: number; destinationChain?: number; period?: string }): Promise<{
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

  getChains(): Array<{ chainId: number; name: string; isL2: boolean }> {
    return CHAINS;
  }

  getTokens(chainId: number): Array<{ address: string; symbol: string; decimals: number }> {
    return TOKENS[chainId] || [];
  }
}

export const routeService = new RouteService();
